/**
 * shell.js —— 建筑本体：基座 / 地面 / 墙体（含门窗洞口）/ 门扇 / 天花
 *
 * 关键实现：
 *  1) 墙体开洞：把一面墙拆成沿墙方向的若干"实体片段"(u0,u1,y0,y1)，
 *     洞口处自动生成窗下墙、窗上墙、门头梁，避免用 ExtrudeGeometry 做布尔。
 *  2) 每面墙拥有独立的材质副本，因此可以用"局部裁剪面"单独把这面墙切到
 *     1.35m（dollhouse 立体剖视：家具完整、墙体剖切）。
 *  3) 天花做两份：一份只投影不显示（colorWrite=false），保证室内光照只从
 *     窗户进来，即使在剖视视角下也不会被正午太阳灌顶；另一份在漫游视角显示。
 *  4) 踢脚线 / 卫生间墙砖都由片段信息自动推导，不需要手写坐标。
 */
import * as THREE from 'three';
import { SHELL, WALLS, DOORS, ROOMS, roomAt } from './plan.js';
import { M } from './materials.js';
import { mergeStatic } from './optimize.js';

const Y0 = 0.0006; // 面片微偏移，防 z-fighting

/** 墙体哪一侧是室内（用于窗台板、门套朝向）：返回 -1/1 */
function interiorSide(wall) {
  const uMid = (wall.from + wall.to) / 2;
  for (const s of [1, -1]) {
    const [px, pz] = wall.axis === 'x'
      ? [uMid, wall.at + s * (wall.t / 2 + 0.15)]
      : [wall.at + s * (wall.t / 2 + 0.15), uMid];
    if (roomAt(px, pz)) return s;
  }
  return 1;
}

/* 把墙拆成实体片段（沿墙 u 方向 + 高度 y）；2D 户型图也复用这套片段逻辑 */
export function wallPieces(wall) {
  const ops = [...wall.openings].sort((a, b) => a.a - b.a);
  const pieces = [];
  let cursor = wall.from;
  for (const op of ops) {
    if (op.a > cursor + 1e-4) pieces.push({ u0: cursor, u1: op.a, y0: 0, y1: SHELL.H });
    const sill = op.t === 'win' ? op.sill : 0;
    const head = op.head ?? SHELL.H;
    if (sill > 1e-4) pieces.push({ u0: op.a, u1: op.b, y0: 0, y1: sill, opening: op });
    if (head < SHELL.H - 1e-4) pieces.push({ u0: op.a, u1: op.b, y0: head, y1: SHELL.H, opening: op, header: true });
    cursor = Math.max(cursor, op.b);
  }
  if (cursor < wall.to - 1e-4) pieces.push({ u0: cursor, u1: wall.to, y0: 0, y1: SHELL.H });
  return pieces;
}

/** 墙体片段 -> 世界包围盒（axis 'x'：墙沿 X 走向） */
function pieceBox(wall, p) {
  const mid = (p.u0 + p.u1) / 2;
  const len = p.u1 - p.u0;
  const h = p.y1 - p.y0;
  const cy = (p.y0 + p.y1) / 2;
  if (wall.axis === 'x') return { size: [len, h, wall.t], pos: [mid, cy, wall.at] };
  return { size: [wall.t, h, len], pos: [wall.at, cy, mid] };
}

export function buildShell() {
  const MAT = M();
  const root = new THREE.Group();
  root.name = 'shell';

  const matInt = MAT.wallPaint.clone();
  const matExt = new THREE.MeshStandardMaterial({
    map: MAT.wallPaint.map, color: 0xdcd6cb, roughness: 0.9, metalness: 0,
  });
  const matBase = new THREE.MeshStandardMaterial({ color: 0xc6c1b6, roughness: 0.9, metalness: 0 });
  const matGround = new THREE.MeshStandardMaterial({ color: 0x87837b, roughness: 1, metalness: 0 });
  const matBase2 = new THREE.MeshStandardMaterial({ color: 0xd6d1c6, roughness: 0.84, metalness: 0 });

  const wallObjs = [];

  /* ---------------- 地面 / 基座 ---------------- */
  const { W, D, plot, slab: slabT } = SHELL;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, -slabT - 0.002, D / 2);
  ground.receiveShadow = true;
  ground.userData.isGround = true;
  root.add(ground);

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + plot * 2, slabT, D + plot * 2), matBase);
  plinth.position.set(W / 2, -slabT / 2, D / 2);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  plinth.userData.isPlinth = true;
  root.add(plinth);

  const plinthTop = new THREE.Mesh(new THREE.BoxGeometry(W + plot * 2 + 0.04, 0.02, D + plot * 2 + 0.04), matBase2);
  plinthTop.position.set(W / 2, -0.011, D / 2);
  plinthTop.receiveShadow = true;
  plinthTop.userData.isPlinth = true;
  root.add(plinthTop);

  /* ---------------- 房间地面 ---------------- */
  const floors = [];
  for (const room of ROOMS) {
    for (const [x0, z0, x1, z1] of room.rects) {
      const w = x1 - x0, d = z1 - z0;
      const geo = new THREE.PlaneGeometry(w, d, 1, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(x0 + w / 2, Y0, z0 + d / 2);
      // UV 用世界坐标：木地板 1m 一循环、地砖 1.2m 一循环，相邻房间缝隙对得上
      const tile = room.floor === 'wood' ? 1.0 : 1.2;
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
      uv.needsUpdate = true;
      const base = room.floor === 'wood' ? MAT.floorWood : MAT.floorTile;
      const mat = base.clone();
      mat.map = base.map; // 共享贴图对象，UV 已按世界坐标排好
      const mesh_ = new THREE.Mesh(geo, mat);
      mesh_.receiveShadow = true;
      mesh_.userData.room = room.id;
      mesh_.userData.floor = true;
      root.add(mesh_);

      const sub = new THREE.Mesh(new THREE.BoxGeometry(w, slabT * 0.6, d), matBase);
      sub.position.set(x0 + w / 2, -slabT * 0.3 - 0.001, z0 + d / 2);
      root.add(sub);
      floors.push(mesh_);
    }
  }

  /* ---------------- 墙体 ---------------- */
  for (const wall of WALLS) {
    const grp = new THREE.Group();
    grp.name = `wall:${wall.id}`;
    grp.userData.wallId = wall.id;
    const isExt = wall.kind === 'ext';
    const baseMat = (isExt ? matExt : matInt).clone();
    // 每面墙只保留"一套"材质副本，合并后 draw call 才能降下来
    const matCache = new Map([[isExt ? matExt : matInt, baseMat]]);
    const share = (src) => {
      let c = matCache.get(src);
      if (!c) { c = src.clone(); matCache.set(src, c); }
      return c;
    };

    const pieces = wallPieces(wall);
    const mats = new Set();
    mats.add(baseMat);
    for (const p of pieces) {
      const { size, pos } = pieceBox(wall, p);
      const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const mesh_ = new THREE.Mesh(g, baseMat);
      mesh_.position.set(pos[0], pos[1], pos[2]);
      mesh_.castShadow = true;
      mesh_.receiveShadow = true;
      mesh_.userData.roomWall = wall.id;
      grp.add(mesh_);
    }

    const inSide = interiorSide(wall);
    const sink = { add: (m) => { if (m) mats.add(m); } };
    for (const op of wall.openings) {
      if (op.t === 'win') grp.add(buildWindow(wall, op, sink, share, inSide));
      else if (op.t === 'door') grp.add(buildDoorFrame(wall, op, sink, share, inSide));
      else grp.add(buildPassTrim(wall, op, sink, share));
    }

    /* 卫生间墙砖：片段贴地部分自动铺砖 */
    for (const ln of wall.linings || []) grp.add(buildLining(wall, ln, pieces, sink, share));

    /* 踢脚线：墙两侧只要挨着房间就自动加 */
    const bb = buildBaseboards(wall, pieces, sink, share);
    if (bb) grp.add(bb);

    // 合并静态 meshes（窗套/门套/通口作为独立单元，因为开场动画要单独缩放）
    mergeStatic(grp);
    for (const c of grp.children) if (c.userData && c.userData.phase === 'opening') mergeStatic(c);

    // 每面墙一个材质实例集合，便于局部剖切
    grp.userData.materials = [...mats];
    grp.userData.axis = wall.axis;
    grp.userData.at = wall.at;
    grp.userData.kind = wall.kind;
    root.add(grp);
    wallObjs.push(grp);
  }

  /* ---------------- 门扇 ---------------- */
  const doorObjs = [];
  for (const d of DOORS) {
    const wall = WALLS.find((w) => w.id === d.wall);
    const grp = new THREE.Group();
    const w = Math.abs(d.b - d.a);
    const th = d.leaf || 0.045;
    const mats = new Set();

    const leafMat = (d.security ? MAT.woodDark : MAT.woodTop).clone();
    mats.add(leafMat);
    const metalMat = MAT.metal.clone();
    mats.add(metalMat);

    const leaf = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w - 0.006, d.head - 0.02, th), leafMat);
    panel.position.set(w / 2, (d.head - 0.02) / 2 + 0.01, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    leaf.add(panel);

    // 门板压线（三道横向凹槽），让门看起来是"日式木板门"
    for (let i = 0; i < 3; i++) {
      const y = 0.45 + i * 0.55;
      if (y > d.head - 0.2) break;
      const groove = new THREE.Mesh(new THREE.BoxGeometry(w - 0.16, 0.016, th + 0.008), leafMat);
      groove.position.set(w / 2, y, 0);
      leaf.add(groove);
    }
    // 门把手（两侧）
    [-1, 1].forEach((s) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.022), metalMat);
      h.position.set(w - 0.1, 1.0, s * (th / 2 + 0.014));
      h.castShadow = true;
      leaf.add(h);
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 12), metalMat);
      rose.rotation.x = Math.PI / 2;
      rose.position.set(w - 0.1, 1.0, s * (th / 2 + 0.005));
      leaf.add(rose);
    });

    // 铰链
    for (const y of [0.35, d.head - 0.35]) {
      const hg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, th + 0.012), metalMat);
      hg.position.set(0.02, y, 0);
      leaf.add(hg);
    }

    grp.add(leaf);
    leaf.userData.mergeUnit = true;
    grp.position.set(d.hinge[0], 0, d.hinge[1]);

    // 计算"关上"时的朝向：局部 +X 指向另一个门桠
    const other = wall.axis === 'x'
      ? [d.hinge[0] === d.a ? d.b : d.a, wall.at]
      : [wall.at, d.hinge[1] === d.a ? d.b : d.a];
    const dx = other[0] - d.hinge[0], dz = other[1] - d.hinge[1];
    const closedAngle = Math.atan2(-dz, dx);
    leaf.rotation.y = closedAngle;

    grp.userData.door = {
      id: d.id, name: d.name, closedAngle, openAngle: closedAngle + d.openAngle,
      leaf, materials: [...mats], open: false, t: 0,
    };
    mergeStatic(leaf);
    root.add(grp);
    doorObjs.push(grp);
  }

  /* ---------------- 天花 ---------------- */
  const ceilGeo = new THREE.BoxGeometry(W, 0.14, D);
  const ceilShadow = new THREE.Mesh(ceilGeo, new THREE.MeshStandardMaterial({
    color: 0xffffff, colorWrite: false, depthWrite: false,
  }));
  ceilShadow.position.set(W / 2, SHELL.H + 0.07, D / 2);
  ceilShadow.castShadow = true;
  ceilShadow.userData.isCeilingShadow = true;
  root.add(ceilShadow);

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.1, D - 0.02), MAT.ceilingPaint);
  ceiling.position.set(W / 2, SHELL.H + 0.05, D / 2);
  ceiling.receiveShadow = true;
  ceiling.visible = false;
  ceiling.userData.isCeiling = true;
  root.add(ceiling);

  return { root, wallObjs, doorObjs, floors, ceiling, ceilingShadow: ceilShadow };
}

/* ------------------------------ 构件 ------------------------------ */

function buildWindow(wall, op, sink, share, inSide = 1) {
  const MAT = M();
  const grp = new THREE.Group();
  grp.userData.phase = 'opening';
  grp.userData.mergeUnit = true;
  const w = op.b - op.a, h = op.head - op.sill;
  const mid = (op.a + op.b) / 2;
  const t = wall.t;
  const frameMat = share(MAT.wood);
  const glassMat = share(MAT.glass);
  sink.add(frameMat); sink.add(glassMat);
  const P = 0.055; // 框料宽

  const put = (sw, sh, sd, u, y, off) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), frameMat);
    if (wall.axis === 'x') b.position.set(u, y, wall.at + off);
    else { b.position.set(wall.at + off, y, u); b.rotation.y = Math.PI / 2; }
    b.castShadow = true; b.receiveShadow = true;
    grp.add(b);
  };

  put(w, P, t, mid, op.sill + P / 2, 0);
  put(w, P, t, mid, op.head - P / 2, 0);
  put(P, h, t, op.a + P / 2, op.sill + h / 2, 0);
  put(P, h, t, op.b - P / 2, op.sill + h / 2, 0);

  const panes = Math.max(1, op.panes || 1);
  for (let i = 1; i < panes; i++) {
    put(0.045, h, t, op.a + (w / panes) * i, op.sill + h / 2, 0);
  }
  // 横向中挺（高窗/落地窗都好看）
  if (h > 1.4) put(w, 0.04, t * 0.8, mid, op.sill + h * 0.62, 0);

  // 玻璃
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w - P * 2, h - P * 2, 0.012), glassMat);
  if (wall.axis === 'x') glass.position.set(mid, op.sill + h / 2, wall.at);
  else { glass.position.set(wall.at, op.sill + h / 2, mid); glass.rotation.y = Math.PI / 2; }
  glass.castShadow = false;
  glass.receiveShadow = false;
  glass.userData.glass = true;
  grp.add(glass);

  // 窗台板（室内侧）
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.03, t + 0.16), frameMat);
  if (wall.axis === 'x') sill.position.set(mid, op.sill - 0.015, wall.at + inSide * 0.06);
  else { sill.position.set(wall.at + inSide * 0.06, op.sill - 0.015, mid); sill.rotation.y = Math.PI / 2; }
  sill.castShadow = true;
  sill.receiveShadow = true;
  grp.add(sill);
  return grp;
}

function buildDoorFrame(wall, op, sink, share, inSide = 1) {
  const MAT = M();
  const grp = new THREE.Group();
  grp.userData.phase = 'opening';
  grp.userData.mergeUnit = true;
  const t = wall.t;
  const w = op.b - op.a;
  const mat = share(MAT.wood);
  sink.add(mat);
  const put = (sw, sh, sd, u, y) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), mat);
    if (wall.axis === 'x') b.position.set(u, y, wall.at);
    else { b.position.set(wall.at, y, u); b.rotation.y = Math.PI / 2; }
    b.castShadow = true; b.receiveShadow = true;
    grp.add(b);
  };
  const J = 0.05;
  put(J, op.head, t + 0.03, op.a - J / 2, op.head / 2);
  put(J, op.head, t + 0.03, op.b + J / 2, op.head / 2);
  put(w + J * 2, J, t + 0.03, (op.a + op.b) / 2, op.head + J / 2);
  return grp;
}

function buildPassTrim(wall, op, sink, share) {
  const MAT = M();
  const grp = new THREE.Group();
  grp.userData.phase = 'opening';
  grp.userData.mergeUnit = true;
  const mat = share(MAT.wood);
  sink.add(mat);
  const t = wall.t;
  const put = (sw, sh, sd, u, y) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), mat);
    if (wall.axis === 'x') b.position.set(u, y, wall.at);
    else { b.position.set(wall.at, y, u); b.rotation.y = Math.PI / 2; }
    b.castShadow = true;
    grp.add(b);
  };
  const off = t / 2 + 0.012;
  put(0.02, op.head, off * 2, op.a + 0.01, op.head / 2);
  put(0.02, op.head, off * 2, op.b - 0.01, op.head / 2);
  put(op.b - op.a, 0.03, off * 2, (op.a + op.b) / 2, op.head - 0.015);
  return grp;
}

function buildLining(wall, ln, pieces, sink, share) {
  const MAT = M();
  const grp = new THREE.Group();
  const mat = share(ln.mat === 'stone' ? MAT.stone : MAT.ceramicTileWall);
  sink.add(mat);
  const h = ln.h;
  const sideSign = ln.side === '+x' ? 1 : ln.side === '-x' ? -1 : ln.side === '+z' ? 1 : -1;
  const along = ln.side === '+x' || ln.side === '-x';
  const th = 0.014;
  const off = wall.t / 2 + th / 2 - 0.002;
  for (const p of pieces) {
    if (p.y0 > 0.01) continue; // 只有贴地的片段才铺砖
    const u0 = Math.max(p.u0, ln.from ?? -Infinity);
    const u1 = Math.min(p.u1, ln.to ?? Infinity);
    if (u1 - u0 < 0.02) continue;
    const hh = Math.min(p.y1, h);
    if (hh < 0.05) continue;
    const len = u1 - u0, mid = (u0 + u1) / 2;
    const geo = along ? new THREE.BoxGeometry(th, hh, len) : new THREE.BoxGeometry(len, hh, th);
    const m = new THREE.Mesh(geo, mat);
    if (wall.axis === 'x') m.position.set(mid, hh / 2, wall.at + sideSign * off);
    else { m.position.set(wall.at + sideSign * off, hh / 2, mid); m.rotation.y = Math.PI / 2; }
    m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

function buildBaseboards(wall, pieces, sink, share) {
  const MAT = M();
  const grp = new THREE.Group();
  const mat = share(MAT.woodTop);
  sink.add(mat);
  const h = 0.07, th = 0.012;
  const offset = wall.t / 2 + th / 2 - 0.002;
  const sides = [];
  for (const s of [-1, 1]) {
    // 该侧是否挨着房间（用房间数据判断，避免在外墙外侧出现踢脚线）
    const probe = 0.12;
    const [px, pz] = wall.axis === 'x'
      ? [wall.from + (wall.to - wall.from) * 0.5, wall.at + s * (wall.t / 2 + probe)]
      : [wall.at + s * (wall.t / 2 + probe), wall.from + (wall.to - wall.from) * 0.5];
    if (roomAt(px, pz)) sides.push(s);
  }
  if (!sides.length) return null;
  for (const s of sides) {
    for (const p of pieces) {
      if (p.y0 > 0.01) continue;
      const len = p.u1 - p.u0, mid = (p.u0 + p.u1) / 2;
      if (len < 0.04) continue;
      const geo = wall.axis === 'x'
        ? new THREE.BoxGeometry(len, h, th)
        : new THREE.BoxGeometry(th, h, len);
      const m = new THREE.Mesh(geo, mat);
      if (wall.axis === 'x') m.position.set(mid, h / 2, wall.at + s * offset);
      else { m.position.set(wall.at + s * offset, h / 2, mid); m.rotation.y = Math.PI / 2; }
      m.receiveShadow = true;
      grp.add(m);
    }
  }
  return grp;
}

