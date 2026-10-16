/**
 * lighting.js —— 时间轴驱动的自然光 + 夜晚人工照明
 *
 * · 太阳：DirectionalLight（带 2048 阴影），按时间在正南向天空走一条弧线，
 *   日出 6:00、日落 18:00，正午最高 62°。色温随高度角从橙红过渡到暖白。
 * · 天花只投影不显示，所以白天室内光几乎全部来自窗口，地上会出现窗洞光斑。
 * · 人工照明：每盏台灯/吊灯自带 PointLight / SpotLight，18:00–07:00 之间
 *   按 S 曲线自动亮起，并同步点亮灯罩与灯泡的自发光材质。
 */
import * as THREE from 'three';
import { SHELL, ROOMS } from './plan.js';
import { M } from './materials.js';

const CENTER = new THREE.Vector3(SHELL.W / 2, 0, SHELL.D / 2);
const MAX_EL = THREE.MathUtils.degToRad(62);

/** 关键帧：太阳强度/环境光/曝光/灯光开关/天空三色 */
const KEYS = [
  { h: 0, sun: 0, sunInt: 0, hemi: 0.10, amb: 0.07, exp: 0.96, lamp: 1, top: 0x0d1b2a, mid: 0x16212e, bot: 0x0a0f16 },
  { h: 5, sun: 0, sunInt: 0.05, hemi: 0.14, amb: 0.08, exp: 0.98, lamp: 1, top: 0x14243a, mid: 0x1d2b3c, bot: 0x0e141c },
  { h: 6, sun: 0.4, sunInt: 0.5, hemi: 0.30, amb: 0.13, exp: 1.02, lamp: 0.95, top: 0x33507a, mid: 0xc98a6a, bot: 0x6d4a30 },
  { h: 6.8, sun: 0.7, sunInt: 1.2, hemi: 0.50, amb: 0.20, exp: 1.04, lamp: 0.45, top: 0x4f76a2, mid: 0xd99f7a, bot: 0x8a6a4a },
  { h: 7.6, sun: 0.9, sunInt: 2.1, hemi: 0.72, amb: 0.26, exp: 1.01, lamp: 0.0, top: 0x6f9cc4, mid: 0xd9e4e6, bot: 0xa8a396 },
  { h: 10, sun: 1, sunInt: 3.1, hemi: 0.88, amb: 0.31, exp: 1.0, lamp: 0, top: 0x7aa2c4, mid: 0xdde6e9, bot: 0xb2aca0 },
  { h: 12, sun: 1, sunInt: 3.4, hemi: 0.95, amb: 0.34, exp: 1.0, lamp: 0, top: 0x7ea6c8, mid: 0xdfe7ea, bot: 0xb6b0a4 },
  { h: 15, sun: 1, sunInt: 3.2, hemi: 0.90, amb: 0.32, exp: 1.0, lamp: 0, top: 0x789fc2, mid: 0xdfe5e6, bot: 0xb4aca0 },
  { h: 17, sun: 1, sunInt: 2.2, hemi: 0.72, amb: 0.26, exp: 1.0, lamp: 0, top: 0x6f97bd, mid: 0xe2e2dc, bot: 0xb0a89a },
  { h: 17.8, sun: 0.8, sunInt: 1.2, hemi: 0.52, amb: 0.20, exp: 1.02, lamp: 0.35, top: 0x5b7fac, mid: 0xe6bf9c, bot: 0xa07a56 },
  { h: 18.6, sun: 0.5, sunInt: 0.35, hemi: 0.32, amb: 0.14, exp: 1.05, lamp: 0.9, top: 0x3f5d8c, mid: 0xe0915c, bot: 0x8a5f3a },
  { h: 19.6, sun: 0, sunInt: 0.04, hemi: 0.18, amb: 0.10, exp: 1.0, lamp: 1, top: 0x1b2b46, mid: 0x2a3a52, bot: 0x141a26 },
  { h: 21, sun: 0, sunInt: 0, hemi: 0.11, amb: 0.075, exp: 0.96, lamp: 1, top: 0x0d1b2a, mid: 0x16212e, bot: 0x0a0f16 },
  { h: 24, sun: 0, sunInt: 0, hemi: 0.10, amb: 0.07, exp: 0.96, lamp: 1, top: 0x0d1b2a, mid: 0x16212e, bot: 0x0a0f16 },
];

const cA = new THREE.Color(), cB = new THREE.Color();
const SUN_LOW = new THREE.Color(0xff8a4a);
const SUN_HIGH = new THREE.Color(0xfff6e8);

function sample(h) {
  h = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const A = KEYS[i], B = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((h - A.h) / (B.h - A.h), 0, 1);
  const mix = (k) => A[k] + (B[k] - A[k]) * t;
  const mixCol = (k, out) => out.copy(cA.setHex(A[k])).lerp(cB.setHex(B[k]), t);
  const top = mixCol('top', new THREE.Color());
  const mid = mixCol('mid', new THREE.Color());
  const bot = mixCol('bot', new THREE.Color());
  return {
    sun: mix('sun'), sunInt: mix('sunInt'), hemi: mix('hemi'), amb: mix('amb'),
    exp: mix('exp'), lamp: mix('lamp'), top, mid, bot,
  };
}

/** 太阳方向（单位向量，指向太阳）；6–18 点之间才有高度角 */
export function sunDirection(h) {
  const t = (h - 6) / 12;
  if (t <= -0.15 || t >= 1.15) return new THREE.Vector3(0, 1, 0);
  const el = Math.max(0, Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1))) * MAX_EL;
  const az = Math.PI / 2 - THREE.MathUtils.clamp(t, 0, 1) * Math.PI; // 东 -> 南 -> 西
  const cosEl = Math.cos(el);
  return new THREE.Vector3(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl).normalize();
}

export function createLighting(scene, renderer) {
  const MAT = M();

  /* ------------------------- 天空穹顶 ------------------------- */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 20), MAT.skyMaterial);
  sky.userData.isSky = true;
  scene.add(sky);

  scene.fog = new THREE.FogExp2(0xdfe7ea, 0.0085);

  /* --------------------------- 光源 --------------------------- */
  const hemi = new THREE.HemisphereLight(0xdfe7ea, 0x8a8073, 0.95);
  scene.add(hemi);

  const amb = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(amb);

  const sun = new THREE.DirectionalLight(0xfff6e8, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -11; cam.right = 11; cam.top = 11; cam.bottom = -11;
  cam.near = 0.5; cam.far = 70;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.028;
  // VSM 的 radius 控制两遍模糊半径，blurSamples 控制采样数 —— 软阴影靠这两个
  sun.shadow.radius = 2.6;
  sun.shadow.blurSamples = 12;
  sun.target.position.copy(CENTER);
  scene.add(sun);
  scene.add(sun.target);

  /* 填充光：仅用于"1.35m 剖切"视角 —— 剖开后看到的是实体背面，
     没有填充光会黑成一片，这里用一盏无阴影的方向光从相机侧补亮。 */
  const fill = new THREE.DirectionalLight(0xfff3e4, 0);
  fill.castShadow = false;
  fill.position.set(CENTER.x - 6, 12, CENTER.z + 14);
  fill.target.position.copy(CENTER);
  scene.add(fill);
  scene.add(fill.target);

  /* ------------------------ 人工照明 ------------------------ */
  const lamps = [];

  /** 从家具组里认领所有灯具：生成光源 + 记录自发光材质 */
  function registerLamp(group, spec) {
    const meshes = [];
    group.traverse((o) => { if (o.isMesh && o.userData.lamp) meshes.push(o); });
    if (!meshes.length) return;
    const anchor = new THREE.Vector3();
    meshes[0].getWorldPosition(anchor);

    const cfg = spec || {};
    const color = new THREE.Color(cfg.color ?? 0xffd9a8);
    const distance = cfg.dist ?? 5;
    const intensity = cfg.intensity ?? 6;
    let light;
    if (cfg.shadow) {
      light = new THREE.SpotLight(color, intensity, distance, 1.05, 0.85, 2);
      light.position.copy(anchor);
      light.target.position.set(anchor.x, 0, anchor.z);
      scene.add(light.target);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0008;
      light.shadow.normalBias = 0.02;
      light.shadow.camera.near = 0.25;
      light.shadow.camera.far = distance + 1;
    } else {
      light = new THREE.PointLight(color, intensity, distance, 2);
      light.position.copy(anchor);
      light.position.y = Math.max(0.4, anchor.y - 0.05);
    }
    scene.add(light);
    for (const mm of meshes) {
      mm.userData.baseEmissive = mm.material.emissive ? mm.material.emissive.clone() : new THREE.Color(0);
      mm.userData.baseEmissiveIntensity = mm.material.emissiveIntensity ?? 1;
    }
    lamps.push({
      meshes, light, color, intensity, node: group,
      nightOnly: !!cfg.nightOnly, on: 0, matHashes: meshes.map((x) => x.material),
    });
  }

  const state = {
    hour: 10,
    lampFactor: 0,
    lampShadows: true,
    viewBoost: 1,
    lampPower: 1,
    fill: 0,
    skyVisible: true,
    backdrop: null,   // 非空时用固定背景（剖切图用"图纸底"）
  };

  function apply(h) {
    state.hour = h;
    const s = sample(h);
    const dir = sunDirection(h);

    sun.position.copy(CENTER).addScaledVector(dir, 26);
    sun.target.position.copy(CENTER);
    sun.intensity = s.sunInt;

    // 太阳色温：低角度偏橙，高角度接近日光
    const elev = THREE.MathUtils.clamp(dir.y, 0, 1);
    const warm = 1 - THREE.MathUtils.smoothstep(elev, 0.08, 0.5);
    sun.color.copy(SUN_HIGH).lerp(SUN_LOW, warm);
    sun.visible = s.sunInt > 0.001;

    hemi.intensity = s.hemi * state.viewBoost;
    hemi.color.copy(s.mid);
    hemi.groundColor.set(0x8a8073).multiplyScalar(0.7 + 0.3 * elev);
    amb.intensity = s.amb * state.viewBoost;
    fill.intensity = state.fill;

    renderer.toneMappingExposure = s.exp;

    // 天空 + 雾：剖切图用固定"图纸底"，其余视角用时间驱动的天空
    MAT.skyUniforms.top.value.copy(s.top);
    MAT.skyUniforms.mid.value.copy(s.mid);
    MAT.skyUniforms.bot.value.copy(s.bot);
    sky.visible = state.skyVisible;
    if (state.backdrop !== null) {
      if (scene.background && scene.background.isColor) scene.background.setHex(state.backdrop);
      scene.fog.color.setHex(state.backdrop);
    } else {
      if (scene.background && scene.background.isColor) scene.background.copy(s.mid).lerp(s.top, 0.3);
      scene.fog.color.copy(s.mid);
    }

    // 人工照明强度（S 曲线 + 视口增强系数，避免"夜晚全黑"）
    const lf = THREE.MathUtils.clamp(s.lamp, 0, 1);
    state.lampFactor = lf;
    for (const L of lamps) {
      const on = L.nightOnly ? THREE.MathUtils.smoothstep(lf, 0.55, 1.0) : lf;
      L.on = on;
      L.light.intensity = L.intensity * on * state.lampPower;
      const vis = on > 0.02;
      L.light.visible = vis;
      for (let i = 0; i < L.meshes.length; i++) {
        const mm = L.meshes[i];
        const mat = mm.material;
        if (mat.emissive) {
          mat.emissive.copy(mm.userData.onColor ? cA.setHex(mm.userData.onColor) : L.color);
          mat.emissiveIntensity = on * (mm.userData.onEmissive ?? 1);
        }
      }
    }
  }

  /** 移除全部人工光源（切换家具方案时重建） */
  function clearLamps() {
    for (const L of lamps) {
      scene.remove(L.light);
      if (L.light.target) scene.remove(L.light.target);
      if (L.light.dispose) L.light.dispose();
    }
    lamps.length = 0;
  }

  return {
    sun, hemi, amb, fill, lamps, state, sky, skyMaterial: MAT.skyMaterial,
    setTime: apply,
    sample,
    registerLamp,
    clearLamps,
    setViewBoost(v) { state.viewBoost = v; apply(state.hour); },
    setFill(v) { state.fill = v; apply(state.hour); },
    setSkyVisible(v) { state.skyVisible = v; apply(state.hour); },
    setBackdrop(hex) { state.backdrop = hex; apply(state.hour); },
    setFog(density) { scene.fog.density = density; },
    setLampShadows(v) {
      state.lampShadows = v;
      for (const L of lamps) if (L.light.isSpotLight) L.light.castShadow = v;
    },
    setLampPower(p) { state.lampPower = p; apply(state.hour); },
    get lampFactor() { return state.lampFactor; },
  };
}
