/**
 * intro.js —— 开场动画：从 2D 户型图"长"出整屋
 *
 * 时间线（总长约 7s，可点击跳过）：
 *   0.0–1.5s  2D 户型图在地面上一笔一笔描出来（横向扫描擦除 + 描线高光）
 *   1.1–2.7s  墙体从图上升起（按房间顺序错峰，scale.y 从 0 → 1）
 *   2.5–3.1s  窗框 / 门套 / 通口套逐个弹出
 *   2.9–5.0s  家具从地面浮起并落位（按到玄关的距离错峰）
 *   3.0–4.6s  地面图纸淡出，真实材质地面与阴影接手；太阳从 7:00 升到 10:00
 *   4.4–6.6s  相机从正俯视俯冲切换到 dollhouse 立体剖视
 *   6.6s      交还给 OrbitControls，UI 面板浮现
 */
import * as THREE from 'three';
import { SHELL, ROOMS } from './plan.js';
import { drawPlan } from './twod.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const seg = (t, a, b) => clamp01((t - a) / (b - a));

const T = {
  planOut: [0.05, 1.55],
  walls: [1.15, 2.75],
  openings: [2.5, 3.1],
  furniture: [2.9, 5.0],
  planFade: [3.0, 4.6],
  camera: [4.4, 6.6],
  total: 6.7,
};

export function createIntro({ scene, shell, views, lighting, furnitureGroups, onFinish }) {
  const { W, D, plot } = SHELL;
  const cx = W / 2, cz = D / 2;

  /* ------------------ 2D 图纸：离屏全图 + 可见画布 ------------------ */
  const PX_PER_M = 128;
  const PAD = 64;
  const canvasW = Math.round(W * PX_PER_M + PAD * 2);
  const canvasH = Math.round(D * PX_PER_M + PAD * 2);
  const full = document.createElement('canvas');
  full.width = canvasW; full.height = canvasH;
  const visible = document.createElement('canvas');
  visible.width = canvasW; visible.height = canvasH;
  const fctx = full.getContext('2d');
  const vctx = visible.getContext('2d');

  const furnitureOutlines = furnitureGroups.map((g) => ({
    x: g.userData.plan.x, z: g.userData.plan.z,
    w: g.userData.plan.w, d: g.userData.plan.d, rot: g.userData.plan.rot,
    key: !!g.userData.plan.key, collide: g.userData.meta.collide,
  }));

  function paintFull(mode) {
    drawPlan(fctx, {
      W: canvasW, H: canvasH, pad: PAD, draw: 1,
      furniture: furnitureOutlines, mode, highlight: null,
    });
  }
  paintFull('两室一厅');

  const tex = new THREE.CanvasTexture(visible);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const planeW = canvasW / PX_PER_M;
  const planeD = canvasH / PX_PER_M;
  const planMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, toneMapped: false,
  });
  const planMesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeD), planMat);
  planMesh.rotation.x = -Math.PI / 2;
  planMesh.position.set(cx, 0.006, cz);
  planMesh.renderOrder = 2;
  planMesh.visible = false;
  scene.add(planMesh);

  function paintWipe(t) {
    vctx.clearRect(0, 0, canvasW, canvasH);
    const w = canvasW * t;
    vctx.save();
    vctx.beginPath();
    vctx.rect(0, 0, w, canvasH);
    vctx.clip();
    vctx.drawImage(full, 0, 0);
    vctx.restore();
    if (t > 0.001 && t < 0.999) {
      // 描线高光
      const grd = vctx.createLinearGradient(w - 60, 0, w + 8, 0);
      grd.addColorStop(0, 'rgba(124,138,118,0)');
      grd.addColorStop(0.7, 'rgba(124,138,118,0.55)');
      grd.addColorStop(1, 'rgba(124,138,118,0.95)');
      vctx.fillStyle = grd;
      vctx.fillRect(w - 60, 0, 68, canvasH);
      vctx.strokeStyle = 'rgba(92,105,87,0.9)';
      vctx.lineWidth = 2;
      vctx.beginPath(); vctx.moveTo(w, 0); vctx.lineTo(w, canvasH); vctx.stroke();
    }
    tex.needsUpdate = true;
  }

  /* ------------------ 记录初始状态，便于生长动画 ------------------ */
  const wallItems = shell.wallObjs.map((g, i) => {
    const wallId = g.userData.wallId;
    const room = ROOMS.find((r) => r.id === guessRoomOfWall(wallId)) || ROOMS[0];
    const order = ROOMS.indexOf(room);
    g.scale.y = 0;
    return { g, delay: order * 0.07 + (i % 3) * 0.03 };
  });

  const openingItems = [];
  for (const g of shell.wallObjs) {
    for (const c of g.children) {
      if (c.userData.phase === 'opening') {
        c.scale.setScalar(0.001);
        openingItems.push({ g: c, delay: Math.random() * 0.18 });
      }
    }
  }

  const doorItems = shell.doorObjs.map((g) => {
    g.scale.setScalar(0.001);
    return { g, delay: Math.random() * 0.2 };
  });

  const furnItems = furnitureGroups.map((g) => {
    const h = g.userData.meta.h || 0.5;
    const dist = Math.hypot(g.userData.plan.x - 8.6, g.userData.plan.z - 5.2);
    const delay = clamp01(dist / 9) * 0.55;
    g.position.y = -Math.min(1.4, h + 0.35);
    g.scale.setScalar(0.86);
    return { g, delay, baseY: 0 };
  });

  const floors = shell.floors.map((f) => {
    f.visible = true;
    return f;
  });

  /* ------------------ 时间轴 ------------------ */
  const state = { t: 0, playing: false, finished: false, camSet: false, handed: false };

  function start() {
    state.playing = true;
    state.t = 0;
    planMesh.visible = true;
    lighting.setTime(7.0);
    views.setInputEnabled(false);
    views.setMode('top');
    views.state.flying = false;
  }

  function update(dt) {
    if (!state.playing || state.finished) return;
    state.t += dt;
    const t = state.t;

    /* --- 1) 图纸描线 --- */
    const pw = easeInOut(seg(t, T.planOut[0], T.planOut[1]));
    paintWipe(pw);
    planMat.opacity = 1 - seg(t, T.planFade[0], T.planFade[1]);

    /* --- 2) 墙体升起 --- */
    const wp = seg(t, T.walls[0], T.walls[1]);
    for (const it of wallItems) {
      const local = clamp01((wp - it.delay) / (1 - it.delay * 0.9));
      it.g.scale.y = easeOut(local);
      it.g.visible = local > 0.001;
    }

    /* --- 3) 窗框门套弹出 --- */
    const op = seg(t, T.openings[0], T.openings[1]);
    for (const it of openingItems) {
      const local = clamp01((op - it.delay) / 0.7);
      const s = easeOut(local);
      it.g.scale.setScalar(Math.max(0.001, s));
    }
    for (const it of doorItems) {
      const local = clamp01((op - it.delay) / 0.7);
      it.g.scale.setScalar(Math.max(0.001, easeOut(local)));
    }

    /* --- 4) 家具浮起 --- */
    const fp = seg(t, T.furniture[0], T.furniture[1]);
    for (const it of furnItems) {
      const local = clamp01((fp - it.delay) / 0.6);
      const e = easeOut(local);
      const h = it.g.userData.meta.h || 0.5;
      it.g.position.y = -Math.min(1.4, h + 0.35) * (1 - e);
      it.g.scale.setScalar(0.86 + 0.14 * e);
    }

    /* --- 5) 太阳升起 --- */
    lighting.setTime(THREE.MathUtils.lerp(7.0, 10.0, easeInOut(seg(t, 1.2, 6.4))));

    /* --- 6) 相机 --- */
    if (!state.camSet && t >= 2.55) {
      state.camSet = true;
      views.setMode('dollhouse');
      views.setInputEnabled(false);
      views.state.flying = false;
    }
    if (state.camSet) {
      const cp = easeInOut(seg(t, T.camera[0], T.camera[1]));
      const from = new THREE.Vector3(cx, 27, cz + 0.02);
      const to = new THREE.Vector3(cx + 12.2, 10.4, cz + 14.6);
      const pos = from.clone().lerp(to, cp);
      // 起飞阶段先俯视，再逐渐拉起视角
      const look = new THREE.Vector3(cx, THREE.MathUtils.lerp(0.0, 0.9, cp), cz + THREE.MathUtils.lerp(0.4, 0.0, cp));
      views.placeCamera(pos, look, THREE.MathUtils.lerp(30, 42, cp));
    }

    /* --- 7) 结束 --- */
    if (t >= T.total) finish();
  }

  function finish() {
    if (state.finished) return;
    state.finished = true;
    state.playing = false;
    planMesh.visible = false;
    planMat.dispose();
    tex.dispose();
    for (const it of wallItems) { it.g.scale.y = 1; it.g.visible = true; }
    for (const it of openingItems) it.g.scale.setScalar(1);
    for (const it of doorItems) it.g.scale.setScalar(1);
    for (const it of furnItems) { it.g.position.y = 0; it.g.scale.setScalar(1); }
    lighting.setTime(10.0);
    views.setMode('dollhouse');
    views.setInputEnabled(true);
    if (onFinish) onFinish();
  }

  /** 跳到结尾（点击 / 按键触发） */
  function skip() {
    if (state.finished) return;
    state.t = T.total;
    finish();
  }

  return {
    start, update, skip, finish,
    get playing() { return state.playing; },
    get finished() { return state.finished; },
    get progress() { return clamp01(state.t / T.total); },
    planMesh,
    total: T.total,
  };
}

/** 由墙 id 猜它主要服务的房间，用于错峰顺序 */
function guessRoomOfWall(id) {
  const map = {
    'ext-n': 'master', 'ext-s': 'living', 'ext-w': 'master', 'ext-e': 'kitchen',
    'w-mb': 'master', 'w-bh': 'roomB', 'w-hk': 'kitchen', 'w-kb': 'bath',
    'w-ns': 'hall', 'w-ld': 'living', 'w-de': 'entry',
  };
  return map[id] || 'living';
}
