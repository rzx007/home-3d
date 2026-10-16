/**
 * main.js —— 装配与主循环
 *
 * 启动顺序：
 *   initMaterials → buildShell → 布置家具 → 打光 → 相机视角 → 交互 → 开场动画 → 主循环
 *
 * 三种方案切换时会重建家具与人工光源、重算碰撞盒，其它（墙体/门窗/材质/贴图）
 * 全部复用，所以切换是"立刻"的。
 */
import * as THREE from 'three';
import { SHELL, ROOMS, MODES, MODE_BY_ID, DOORS, WALLS, furnitureFor, roomAt } from './plan.js';
import { initMaterials, M } from './materials.js';
import { buildShell, wallPieces } from './shell.js';
import { createFurniture } from './furniture.js';
import { mergeStatic } from './optimize.js';
import { createLighting } from './lighting.js';
import { createViews, MODE_INFO } from './views.js';
import { createIntro } from './intro.js';
import { createUI, fmtClock } from './ui.js';
import { createLabels } from './labels.js';
import { loadGlbAssets, applyGlbSwap, ASSET_MANIFEST } from './assets.js';

const canvas = document.getElementById('view');

/* ------------------------------ 渲染器 ------------------------------ */
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = true;
// r186 已移除 PCFSoftShadowMap，软阴影用 VSM（两遍模糊，真正柔和）
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe7ea);

/* ------------------------------ 资源 ------------------------------ */
const MAT = initMaterials(renderer);

/* ------------------------------ UI ------------------------------ */
let ui = null;
let views = null;
let lighting = null;
let intro = null;
let shell = null;

const furnitureRoot = new THREE.Group();
furnitureRoot.name = 'furniture';
scene.add(furnitureRoot);

/** 当前模式下所有家具实例：{group, item} */
let furnitureGroups = [];
let glbAssets = { loaded: {}, count: 0, tried: 32 };
let glbEnabled = false;

/* ------------------------------ 户型本体 ------------------------------ */
shell = buildShell();
scene.add(shell.root);

/* ------------------------------ 家具布置 ------------------------------ */
function buildFurniture(modeId) {
  // 清掉旧的（GLB 克隆共享源几何，这种情况下不 dispose）
  for (const g of furnitureGroups) {
    if (!g.userData.usingGlb) {
      g.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
    furnitureRoot.remove(g);
  }
  furnitureGroups = [];
  if (lighting) lighting.clearLamps();

  const items = furnitureFor(modeId);
  const byRoom = new Map();
  for (const item of items) {
    const g = createFurniture(item.t, item);
    const meta = g.userData.meta;
    g.position.set(item.x, item.y || 0, item.z);
    g.rotation.y = THREE.MathUtils.degToRad(item.rot || 0);
    g.userData.roomId = item.room;
    g.userData.plan = {
      x: item.x, z: item.z, rot: item.rot || 0,
      w: meta.w, d: meta.d, key: !!item.key, type: item.t,
    };
    // 灯泡/灯罩带自发光材质，需保持可单独控制；其余静态 mesh 合并降 draw call
    mergeStatic(g);
    furnitureRoot.add(g);
    furnitureGroups.push(g);
    if (!byRoom.has(item.room)) byRoom.set(item.room, []);
    byRoom.get(item.room).push(g);
    if (item.light && lighting) lighting.registerLamp(g, item.light);
  }

  if (glbEnabled && glbAssets.count) applyGlbSwap(furnitureRoot, glbAssets.loaded);

  scene.updateMatrixWorld(true);
  refreshColliders();
  if (ui) {
    ui.assets = furnitureGroups.map((g) => ({
      x: g.userData.plan.x, z: g.userData.plan.z, w: g.userData.plan.w, d: g.userData.plan.d,
      rot: g.userData.plan.rot, key: g.userData.plan.key, collide: g.userData.meta.collide,
    }));
  }
  return byRoom;
}

/* ------------------------------ 碰撞盒 ------------------------------ */
const BOX = new THREE.Box3();
function wallColliders() {
  const out = [];
  for (const wall of WALLS) {
    for (const p of wallPieces(wall)) {
      // 只有落地的、有阻挡高度的片段才挡人（门洞/通口自然留空）
      if (p.y0 > 0.01 || p.y1 < 0.6) continue;
      if (wall.axis === 'x') {
        out.push({ x0: p.u0, z0: wall.at - wall.t / 2, x1: p.u1, z1: wall.at + wall.t / 2 });
      } else {
        out.push({ x0: wall.at - wall.t / 2, z0: p.u0, x1: wall.at + wall.t / 2, z1: p.u1 });
      }
    }
  }
  return out;
}

function furnitureColliders() {
  const out = [];
  for (const g of furnitureGroups) {
    if (g.userData.meta.collide === false) continue;
    if (g.userData.meta.ceiling) continue;
    BOX.setFromObject(g);
    if (BOX.max.y < 0.22) continue; // 几乎贴地的东西不挡人
    out.push({
      x0: BOX.min.x, z0: BOX.min.z, x1: BOX.max.x, z1: BOX.max.z,
      h: BOX.max.y,
    });
  }
  return out;
}

function refreshColliders() {
  if (!views) return;
  views.setColliders([...wallColliders(), ...furnitureColliders()]);
}

/* ------------------------------ 灯光 ------------------------------ */
lighting = createLighting(scene, renderer);
lighting.setTime(10);

/* ------------------------------ 视角 ------------------------------ */
views = createViews({
  renderer, scene, canvas,
  wallGroups: shell.wallObjs,
  doorObjs: shell.doorObjs,
  onPick: handlePick,
  onLockChange: (locked) => { if (ui) ui.setLocked(locked); },
  onModeChange: () => {},
});

/* ------------------------------ UI ------------------------------ */
ui = createUI({
  onModeChange: (mode) => {
    views.setMode(mode);
    applyPresentation(mode);
    ui.setMiniTag(MODE_INFO[mode].label);
    if (mode === 'walk') {
      views.requestLock();
      const r = views.currentRoom();
      ui.setRoom(r ? r.id : null, true);
    } else {
      views.exitLock();
    }
    shell.ceiling.visible = (mode === 'walk');
    drawMini();
  },
  onLayoutChange: (id) => {
    buildFurniture(id);
    ui.setAssetStatus(assetStatusText());
    if (ui.selected) ui.renderCard(ui.selected, id);
    drawMini();
  },
  onTimeChange: (h) => { lighting.setTime(h); },
  onToggle: (key, value) => {
    if (key === 'labels') labels.setVisible(value);
    if (key === 'lampShadow') lighting.setLampShadows(value);
    if (key === 'glb') {
      glbEnabled = value && glbAssets.count > 0;
      if (value && glbAssets.count === 0) {
        ui.setAssetStatus('未找到 assets/glb/*.glb');
        ui.setGlbToggle(false);
      } else {
        buildFurniture(ui.layout);
        ui.setAssetStatus(assetStatusText());
      }
    }
  },
  onSelectRoom: (roomId) => {
    highlightRoom(roomId);
    if (labels) labels.highlight(roomId, ui.layout);
    drawMini();
  },
});
/* ------------------------------ 3D 房间标签 ------------------------------ */
const labels = createLabels({ container: document.getElementById('hud'), views });

function assetStatusText() {
  if (!glbAssets.count) return `程序化建模 ${ASSET_MANIFEST.length} 件 · 无 GLB`;
  if (glbEnabled) return `GLB 资产 ${glbAssets.count}/${ASSET_MANIFEST.length} 件已替换`;
  return `程序化建模 · 检测到 ${glbAssets.count} 件 GLB`;
}

/* ------------------------------ 房间高亮 ------------------------------ */
let lastHighlight = null;
function highlightRoom(roomId) {
  for (const f of shell.floors) {
    if (!f.material.emissive) continue;
    if (lastHighlight && f.userData.room === lastHighlight) f.material.emissive.setHex(0x000000);
  }
  lastHighlight = roomId;
  if (!roomId) return;
  for (const f of shell.floors) {
    if (f.userData.room === roomId && f.material.emissive) f.material.emissive.setHex(0x2a3a28);
  }
}

/* --------------------------- 视角演示参数 --------------------------- */
/** 每个视角的环境光/填充光/雾/地面策略：剖切图靠填充光才看得清 */
const PRESENTATION = {
  dollhouse: { boost: 0.98, fill: 0.3, fog: 0.0072, ground: true, sky: true, backdrop: null },
  top: { boost: 1.04, fill: 0.2, fog: 0.0052, ground: true, sky: true, backdrop: null },
  // 剖切图：隐天空/地面 + 图纸底 + 强填充光，读起来跟制图一样
  section: { boost: 1.55, fill: 1.15, fog: 0.0034, ground: false, sky: false, backdrop: 0xe7e2d7 },
  walk: { boost: 0.82, fill: 0.0, fog: 0.0090, ground: true, sky: true, backdrop: null },
};

function applyPresentation(mode) {
  const p = PRESENTATION[mode] || PRESENTATION.dollhouse;
  lighting.setViewBoost(p.boost);
  lighting.setFill(p.fill);
  lighting.setFog(p.fog);
  lighting.setSkyVisible(p.sky);
  lighting.setBackdrop(p.backdrop);
  shell.root.traverse((o) => {
    if (o.userData && (o.userData.isGround || o.userData.isPlinth)) o.visible = p.ground;
  });
}

/* ------------------------------ 拾取 ------------------------------ */
const raycaster = new THREE.Raycaster();
const ndcTmp = new THREE.Vector2();

function pickables() {
  return [shell.root, furnitureRoot];
}

function roomFromHit(hit) {
  const o = hit.object;
  if (o.userData.floor && o.userData.room) return o.userData.room;
  if (o.userData.roomWall) {
    // 墙面：沿法线往里走一点，落在哪个房间就属于哪个房间
    const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    n.transformDirection(o.matrixWorld);
    const p = hit.point.clone().addScaledVector(n, 0.22);
    const r = roomAt(p.x, p.z);
    if (r) return r.id;
  }
  // 家具：往它所属房间找
  let cur = o;
  while (cur) {
    if (cur.userData.roomId) return cur.userData.roomId;
    cur = cur.parent;
  }
  const r = roomAt(hit.point.x, hit.point.z);
  return r ? r.id : null;
}

function findDoor(o) {
  let cur = o;
  while (cur) {
    if (cur.userData.door) return cur;
    cur = cur.parent;
  }
  return null;
}

function handlePick(ndc) {
  if (intro && !intro.finished) return;
  raycaster.setFromCamera(ndc, views.camera);
  const hits = raycaster.intersectObjects(pickables(), true);
  for (const h of hits) {
    const o = h.object;
    if (o.userData.isSky || o.userData.isGround || o.userData.isCeilingShadow || o.userData.isCeiling) continue;
    if (o.userData.glass) continue;
    const door = findDoor(o);
    if (door) {
      views.toggleDoor(door);
      return;
    }
    const roomId = roomFromHit(h);
    if (roomId) {
      ui.setRoom(roomId, true);
    } else {
      ui.setRoom(null, true);
    }
    return;
  }
  ui.setRoom(null, true);
}

/* ------------------------------ 迷你地图 ------------------------------ */
let miniTimer = 0;
function drawMini() {
  ui.drawMini(views, views.mode === 'walk' && views.currentRoom() ? views.currentRoom().name : null);
}

/* ------------------------------ 开场动画 ------------------------------ */
intro = createIntro({
  scene, shell, views, lighting, furnitureGroups,
  onFinish: () => {
    ui.hideIntro();
    ui.revealHud();
    ui.assets = furnitureGroups.map((g) => ({
      x: g.userData.plan.x, z: g.userData.plan.z, w: g.userData.plan.w, d: g.userData.plan.d,
      rot: g.userData.plan.rot, key: g.userData.plan.key, collide: g.userData.meta.collide,
    }));
    drawMini();
  },
});

/* ------------------------------ 主循环 ------------------------------ */
let lastT = performance.now();
let frames = 0;

function frame(now) {
  const t = typeof now === 'number' ? now : performance.now();
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  frames++;

  if (intro && !intro.finished) {
    intro.update(dt);
    ui.setIntroProgress(intro.progress);
    const p = intro.progress;
    const steps = [
      [0.02, '正在描出户型图…'],
      [0.24, '墙体从图上生长…'],
      [0.42, '窗框与门套就位…'],
      [0.58, '家具进入房间…'],
      [0.78, '太阳升高，光斑落进客厅…'],
      [0.93, '切换到立体剖视…'],
    ];
    for (let i = steps.length - 1; i >= 0; i--) {
      if (p >= steps[i][0]) { ui.setIntroStep(steps[i][1]); break; }
    }
  }

  views.update(dt);
  if (labels) labels.update(views.mode);

  // 漫游时相机位置变化 -> 迷你地图降频重绘
  if (views.mode === 'walk') {
    miniTimer += dt;
    if (miniTimer > 0.08) {
      miniTimer = 0;
      drawMini();
      const r = views.currentRoom();
      const tag = r ? r.name : '室外';
      if (ui.selected !== (r ? r.id : null)) ui.setRoom(r ? r.id : null, true);
      ui.setMiniTag(`漫游 · ${tag}`);
    }
  }

  renderer.render(scene, views.camera);
}

/* ------------------------------ 启动 ------------------------------ */
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  views.resize(w, h);
}
window.addEventListener('resize', resize);

function boot() {
  resize();
  buildFurniture('work');
  ui.setAssetStatus(assetStatusText());
  ui.setMode('dollhouse', false);
  ui.setLayout('work', false);
  ui.setRoom('roomB', false);
  highlightRoom('roomB');
  labels.highlight('roomB', 'work');
  applyPresentation('dollhouse');
  shell.ceiling.visible = false;
  drawMini();

  ui.onSkipIntro(() => {
    intro.skip();
  });
  window.addEventListener('keydown', (e) => {
    if (!intro.finished && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) intro.skip();
  });

  intro.start();
  ui.bootDone();
  ui.setBootText('');
  renderer.setAnimationLoop(frame);

  // 后台尝试加载 Blender 预制的 32 件 GLB（缺失时保持程序化建模）
  setTimeout(() => {
    loadGlbAssets({
      onProgress: (i, n) => {
        if (i === n) ui.setAssetStatus(assetStatusText());
      },
    }).then((res) => {
      glbAssets = res;
      ui.setAssetStatus(assetStatusText());
      if (res.count > 0) ui.setGlbToggle(true);
    }).catch(() => { ui.setAssetStatus(assetStatusText()); });
  }, 400);
}

try {
  boot();
} catch (err) {
  console.error(err);
  ui.fail(`启动失败：\n${err && err.stack ? err.stack : err}`);
}

// 便于在控制台调试
window.__house = {
  version: '2026-10-16.3',
  THREE, scene, renderer, get views() { return views; },
  get lighting() { return lighting; }, get intro() { return intro; },
  get shell() { return shell; }, get ui() { return ui; },
  get furniture() { return furnitureGroups; },
  get frames() { return frames; },
  rebuild: (m) => buildFurniture(m),
  setTime: (h) => lighting.setTime(h),
  glb: () => glbAssets,
};
