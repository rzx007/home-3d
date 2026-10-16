/**
 * views.js —— 四种视角 + 相机控制 + 第一人称漫游与碰撞
 *
 * 1) dollhouse  立体剖视：透视轨道观察，墙体用"局部裁剪面"切到 1.35m，
 *               家具保持完整、天花不显示 —— 销售户型图那种立体剖视。
 * 2) top        正交俯视：OrthographicCamera 正上方俯视，up=(0,0,-1) 让北朝上，
 *               只允许平移缩放，等同于看施工图。
 * 3) section    1.35m 剖切：用一个全局裁剪面把整栋（含家具）切在 1.35m 以下，
 *               低 FOV 长焦近似轴测，读起来像剖面图。
 * 4) walk       第一人称漫游：WASD + 鼠标锁定视角，AABB 碰撞，点击门扇开合。
 *
 * 两个裁剪面在初始化时就挂到材质上（初始 constant=100 即"不切"），
 * GPU 程序启动时一次编译完成，切换视角不会卡顿。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SHELL, roomAt } from './plan.js';

const CUT_H = SHELL.cutH;
const EYE = 1.62;
const RADIUS = 0.26;
const NO_CUT = 100;
const PLAY_BOUND = { x0: -0.4, x1: SHELL.W + 0.4, z0: -0.4, z1: SHELL.D + 0.4 };

export const MODE_INFO = {
  dollhouse: { label: '立体剖视', short: 'Dollhouse', hint: '拖动旋转 · 滚轮缩放 · 单击房间看面积与家具' },
  top: { label: '正交俯视', short: 'Plan', hint: '拖动平移 · 滚轮缩放 · 图面北向朝上' },
  section: { label: '1.35m 剖切', short: 'Section', hint: '整栋切在 1.35m 以下 · 可拖动旋转' },
  walk: { label: '第一人称漫游', short: 'Walk', hint: '点击画面锁定鼠标 · WASD 移动 · Shift 快走 · E 开门 · Esc 退出' },
};

export const MODE_ORDER = ['dollhouse', 'top', 'section', 'walk'];

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function createViews({ renderer, scene, canvas, wallGroups, doorObjs, onPick, onLockChange, onModeChange }) {
  const cx = SHELL.W / 2, cz = SHELL.D / 2;
  /* --------------------------- 相机 --------------------------- */
  const persp = new THREE.PerspectiveCamera(46, 1, 0.06, 240);
  persp.position.set(cx + 12.5, 10.2, cz + 14.5);
  persp.rotation.order = 'YXZ';

  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 140);
  ortho.position.set(cx, 34, cz);
  ortho.up.set(0, 0, -1);
  ortho.lookAt(cx, 0, cz);

  /* ------------- 裁剪面（预热，避免切换时编译卡顿） ------------- */
  const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), NO_CUT);
  renderer.clippingPlanes = [sectionPlane];
  renderer.localClippingEnabled = true;

  const dollPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), NO_CUT);
  const wallMats = [];
  const addClip = (m) => {
    if (!m || m.userData.__dollClipped) return;
    m.clippingPlanes = [dollPlane];
    m.clipShadows = true;
    m.userData.__dollClipped = true;
    wallMats.push(m);
  };
  for (const g of wallGroups) for (const m of g.userData.materials) addClip(m);
  // 门扇也要一起剖切，否则墙上切了、门还立着两米高
  for (const g of doorObjs) {
    const d = g.userData.door;
    if (d && d.materials) for (const m of d.materials) addClip(m);
  }

  /* ------------------------ 轨道控制 ------------------------ */
  const cOrbit = new OrbitControls(persp, canvas);
  cOrbit.enableDamping = true;
  cOrbit.dampingFactor = 0.08;
  cOrbit.minDistance = 3.5;
  cOrbit.maxDistance = 70;
  cOrbit.maxPolarAngle = Math.PI * 0.495;
  cOrbit.minPolarAngle = 0.1;
  cOrbit.target.set(cx, 0.9, cz);
  cOrbit.enabled = false;

  const cTop = new OrbitControls(ortho, canvas);
  cTop.enableDamping = true;
  cTop.dampingFactor = 0.12;
  cTop.enableRotate = false;
  cTop.screenSpacePanning = true;
  cTop.minZoom = 0.35;
  cTop.maxZoom = 6;
  cTop.target.set(cx, 0, cz);
  cTop.enabled = false;

  const state = {
    mode: 'dollhouse',
    flying: false,
    flyT: 0,
    flyFrom: new THREE.Vector3(),
    flyFromQ: new THREE.Quaternion(),
    flyFromTarget: new THREE.Vector3(),
    input: true,
    goalPos: new THREE.Vector3(cx + 12.2, 10.4, cz + 14.6),
    goalTarget: new THREE.Vector3(cx, 0.9, cz),
    cut: CUT_H,
    cutGoal: CUT_H,
    section: 0,
    sectionGoal: 0,
    boost: 1,
    doubleSided: false,
  };

  /* -------------------------- 第一人称 -------------------------- */
  const player = { x: 8.6, z: 5.2, yaw: Math.PI / 2, pitch: 0, vx: 0, vz: 0, locked: false };
  const keys = Object.create(null);
  const colliders = [];
  const doorCollide = new Map();
  let activeCam = persp;

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (state.mode === 'walk') {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyQ') for (const g of doorObjs) if (g.userData.door.open) g.userData.door.open = false;
      if (e.code === 'KeyE') toggleNearestDoor();
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  document.addEventListener('pointerlockchange', () => {
    player.locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(player.locked);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (state.mode !== 'walk' || !player.locked) return;
    player.yaw -= e.movementX * 0.0021;
    player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0021, -1.35, 1.35);
  });

  canvas.addEventListener('click', (e) => {
    if (!onPick) return;
    if (state.mode === 'walk') {
      if (!player.locked) { canvas.requestPointerLock(); return; }
      onPick(new THREE.Vector2(0, 0)); // 准心拾取
      return;
    }
    const rect = canvas.getBoundingClientRect();
    onPick(new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    ));
  });

  /* --------------------------- 双面渲染 --------------------------- */
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m && m.side !== undefined && m.userData.origSide === undefined) m.userData.origSide = m.side;
  });
  function setDoubleSided(on) {
    if (state.doubleSided === on) return;
    state.doubleSided = on;
    scene.traverse((o) => {
      if (!o.isMesh || o.userData.isSky) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || m.side === undefined) continue;
        m.side = on ? THREE.DoubleSide : (m.userData.origSide ?? THREE.FrontSide);
      }
    });
  }

  /* --------------------------- 视角切换 --------------------------- */
  const tmpTarget = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const FLY_DUR = 1.15; // 秒：按墙钟时间过渡，帧率高/低表现一致

  function flyTo(pos, target, boost = 1) {
    const cam = activeCam;
    state.flyFrom.copy(cam.position);
    state.flyFromQ.copy(cam.quaternion);
    state.flyFromTarget.copy(cOrbit.target);
    state.goalPos.set(pos[0], pos[1], pos[2]);
    state.goalTarget.set(target[0], target[1], target[2]);
    state.flyT = 0;
    state.flying = true;
    state.boost = boost;
    cOrbit.enabled = false;
    cTop.enabled = false;
  }

  /** 开场动画期间关闭所有鼠标输入 */
  function setInputEnabled(v) {
    state.input = v;
    if (!v) { cOrbit.enabled = false; cTop.enabled = false; }
    else { cOrbit.enabled = true; cOrbit.update(); }
  }
  /** 直接摆相机（开场动画自用） */
  function placeCamera(pos, target, fov) {
    state.flying = false;
    cOrbit.enabled = false;
    cTop.enabled = false;
    persp.position.copy(pos);
    if (fov) { persp.fov = fov; persp.updateProjectionMatrix(); }
    tmpMat.lookAt(persp.position, target, persp.up);
    persp.quaternion.setFromRotationMatrix(tmpMat);
    cOrbit.target.copy(target);
  }

  function setMode(mode) {
    if (!MODE_INFO[mode]) return;
    state.mode = mode;

    if (mode === 'walk') {
      activeCam = persp;
      cOrbit.enabled = false; cTop.enabled = false;
      persp.fov = 68; persp.near = 0.05; persp.updateProjectionMatrix();
      persp.up.set(0, 1, 0);
      state.flying = false;
      state.cutGoal = NO_CUT;
      state.sectionGoal = 0;
      setDoubleSided(false);
      state.boost = 0.85;
    } else if (mode === 'dollhouse') {
      activeCam = persp;
      cTop.enabled = false;
      persp.fov = 42; persp.near = 0.06; persp.updateProjectionMatrix();
      persp.up.set(0, 1, 0);
      state.cutGoal = CUT_H;
      state.sectionGoal = 0;
      setDoubleSided(false);
      cOrbit.enableRotate = true;
      cOrbit.target.set(cx, 0.9, cz);
      flyTo([cx + 12.2, 10.4, cz + 14.6], [cx, 0.9, cz], 1.08);
    } else if (mode === 'top') {
      activeCam = ortho;
      cOrbit.enabled = false;
      ortho.up.set(0, 0, -1);
      ortho.zoom = 1;
      ortho.updateProjectionMatrix();
      state.cutGoal = NO_CUT;
      state.sectionGoal = 0;
      setDoubleSided(false);
      cTop.target.set(cx, 0, cz);
      state.flying = true;
      state.goalPos.set(cx, 34, cz);
      state.goalTarget.set(cx, 0, cz);
      state.boost = 1.12;
    } else if (mode === 'section') {
      activeCam = persp;
      cTop.enabled = false;
      persp.fov = 21; persp.near = 1; persp.updateProjectionMatrix();
      persp.up.set(0, 1, 0);
      state.cutGoal = NO_CUT;
      state.sectionGoal = 1;
      setDoubleSided(true);
      cOrbit.enableRotate = true;
      cOrbit.target.set(cx, 1.2, cz);
      const d = 24;
      const dir = new THREE.Vector3(0, 0.62, 1).normalize();
      flyTo([cx + dir.x * d, dir.y * d, cz + dir.z * d], [cx, 1.2, cz], 1.0);
    }
    resize();
  }

  /* ---------------------------- 碰撞 ---------------------------- */
  function setColliders(list) {
    colliders.length = 0;
    for (const c of list) colliders.push(c);
  }
  const addCollider = (c) => colliders.push(c);

  const _box = new THREE.Box3();
  function registerDoorCollider(group) {
    const d = group.userData.door;
    if (!d) return;
    d.refresh = () => {
      group.updateWorldMatrix(true, true);
      _box.setFromObject(d.leaf);
      doorCollide.set(d.id, { x0: _box.min.x, z0: _box.min.z, x1: _box.max.x, z1: _box.max.z });
    };
    d.refresh();
  }
  doorObjs.forEach(registerDoorCollider);

  function toggleDoor(idOrGroup) {
    const g = typeof idOrGroup === 'string'
      ? doorObjs.find((x) => x.userData.door.id === idOrGroup) : idOrGroup;
    if (!g) return null;
    const d = g.userData.door;
    d.open = !d.open;
    return d;
  }

  function toggleNearestDoor() {
    let best = null, bestD = Infinity;
    for (const g of doorObjs) {
      const d = g.userData.door;
      const dist = Math.hypot(g.position.x - player.x, g.position.z - player.z);
      const score = dist + (d.open ? 1.5 : 0);
      if (score < bestD) { bestD = score; best = g; }
    }
    return best ? toggleDoor(best) : null;
  }

  function pushOut(c) {
    const x0 = c.x0 - RADIUS, x1 = c.x1 + RADIUS, z0 = c.z0 - RADIUS, z1 = c.z1 + RADIUS;
    if (player.x <= x0 || player.x >= x1 || player.z <= z0 || player.z >= z1) return false;
    const dl = player.x - x0, dr = x1 - player.x, db = player.z - z0, df = z1 - player.z;
    const m = Math.min(dl, dr, db, df);
    if (m === dl) player.x = x0; else if (m === dr) player.x = x1;
    else if (m === db) player.z = z0; else player.z = z1;
    return true;
  }

  function resolveCollisions() {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of colliders) if (pushOut(c)) moved = true;
      for (const c of doorCollide.values()) if (pushOut(c)) moved = true;
      if (!moved) break;
    }
    player.x = THREE.MathUtils.clamp(player.x, PLAY_BOUND.x0, PLAY_BOUND.x1);
    player.z = THREE.MathUtils.clamp(player.z, PLAY_BOUND.z0, PLAY_BOUND.z1);
  }

  /* --------------------------- 每帧更新 --------------------------- */
  function stepPlanes(dt) {
    if (Math.abs(state.cut - state.cutGoal) > 0.002) {
      state.cut += (state.cutGoal - state.cut) * Math.min(1, dt * 6);
    } else state.cut = state.cutGoal;
    dollPlane.constant = state.cut;

    if (Math.abs(state.section - state.sectionGoal) > 0.002) {
      state.section += (state.sectionGoal - state.section) * Math.min(1, dt * 7.5);
    } else state.section = state.sectionGoal;
    sectionPlane.constant = THREE.MathUtils.lerp(SHELL.H + 0.8, CUT_H, state.section);
  }

  function stepDoors(dt) {
    for (const g of doorObjs) {
      const d = g.userData.door;
      const target = d.open ? 1 : 0;
      if (Math.abs(d.t - target) > 0.0005) {
        d.t += (target - d.t) * Math.min(1, dt * 4.2);
        if (Math.abs(d.t - target) < 0.008) d.t = target;
        d.leaf.rotation.y = THREE.MathUtils.lerp(d.closedAngle, d.openAngle, easeInOut(d.t));
        if (d.refresh) d.refresh();
      }
    }
  }

  let bobT = 0;
  function stepWalk(dt) {
    const speed = (keys.ShiftLeft || keys.ShiftRight) ? 4.1 : 2.45;
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1;
    if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    // 前方 = (-sin, -cos)，右方 = (cos, -sin)
    const tvx = (sin * fz + cos * fx) * speed;
    const tvz = (cos * fz - sin * fx) * speed;
    const k = Math.min(1, dt * 12);
    player.vx += (tvx - player.vx) * k;
    player.vz += (tvz - player.vz) * k;
    const v = Math.hypot(player.vx, player.vz);
    if (v > 1e-4) {
      player.x += player.vx * dt;
      player.z += player.vz * dt;
      resolveCollisions();
    }
    bobT += dt * v * 3.2;
    const bob = v > 0.35 ? Math.sin(bobT * 2) * 0.013 : 0;
    persp.position.set(player.x, EYE + bob, player.z);
    persp.rotation.set(player.pitch, player.yaw, 0);
  }

  function stepFly(dt) {
    if (!state.flying) return;
    state.flyT = Math.min(state.flyT + dt, FLY_DUR);
    const e = easeInOut(state.flyT / FLY_DUR);
    const cam = activeCam;
    cam.position.lerpVectors(state.flyFrom, state.goalPos, e);
    if (cam === persp) {
      tmpMat.lookAt(state.goalPos, state.goalTarget, cam.up);
      tmpQ.setFromRotationMatrix(tmpMat);
      cam.quaternion.copy(state.flyFromQ).slerp(tmpQ, e);
      cOrbit.target.lerpVectors(state.flyFromTarget, state.goalTarget, e);
    } else {
      cam.lookAt(state.goalTarget);
    }
    if (state.flyT >= FLY_DUR) {
      cam.position.copy(state.goalPos);
      if (cam === persp) cOrbit.target.copy(state.goalTarget);
      state.flying = false;
      if (!state.input) return;
      if (state.mode === 'dollhouse' || state.mode === 'section') {
        cOrbit.enabled = true;
        cOrbit.update();
      } else if (state.mode === 'top') {
        cTop.enabled = true;
        cTop.update();
      }
    }
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    stepPlanes(dt);
    stepDoors(dt);
    if (state.mode === 'walk') { stepWalk(dt); return; }
    stepFly(dt);
    if (!state.flying) {
      if (!state.input) return;
      if (state.mode === 'top' && cTop.enabled) cTop.update();
      else if (cOrbit.enabled) cOrbit.update();
    }
  }

  function resize(width, height) {
    const w = width ?? canvas.clientWidth;
    const h = height ?? canvas.clientHeight;
    const aspect = w / Math.max(1, h);
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
    const margin = 1.3;
    let halfH = SHELL.D / 2 + margin;
    let halfW = halfH * aspect;
    if (halfW < SHELL.W / 2 + margin) { halfW = SHELL.W / 2 + margin; halfH = halfW / aspect; }
    ortho.left = -halfW; ortho.right = halfW; ortho.top = halfH; ortho.bottom = -halfH;
    ortho.updateProjectionMatrix();
  }

  return {
    persp, ortho, state, player, keys, wallMats,
    setMode, setColliders, addCollider, toggleDoor, toggleNearestDoor,
    update, resize, doorObjs, cOrbit, cTop, setInputEnabled, placeCamera,
    requestLock() {
      // requestPointerLock 返回 Promise，失败（无手势/headless/被拒）时不能抛未捕获异常
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* ignore */ }
    },
    exitLock() {
      try {
        if (document.pointerLockElement) document.exitPointerLock();
      } catch (e) { /* ignore */ }
    },
    get camera() { return activeCam; },
    get mode() { return state.mode; },
    get sectionPlane() { return sectionPlane; },
    get dollPlane() { return dollPlane; },
    currentRoom() { return roomAt(player.x, player.z); },
    notifyMode() { if (onModeChange) onModeChange(state.mode); },
  };
}
