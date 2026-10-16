/**
 * materials.js —— 程序化贴图与材质库
 *
 * 全部贴图由 Canvas2D 现场绘制（木纹 / 布料 / 石材 / 水磨石 / 陶瓷 / 涂料），
 * 并从高度图推导法线贴图，因此不依赖任何外部图片资源。
 * 风格：浅橡木 + 暖白 + 灰绿，低饱和、低对比、哑光为主。
 */
import * as THREE from 'three';

/* ------------------------------ 色板 ------------------------------ */
export const PALETTE = {
  oak: 0xc9a87c,
  oakLight: 0xdcc6a4,
  oakDark: 0xa5814f,
  floorOak: 0xd8c3a2,
  wallWarm: 0xf2ede4,
  wallCool: 0xe9e5db,
  ceiling: 0xf7f4ee,
  greyGreen: 0x7c8a76,
  greyGreenDeep: 0x5c6957,
  cream: 0xece5d6,
  linen: 0xd9d2c3,
  charcoal: 0x3a3936,
  metal: 0x4c4c4a,
  steel: 0xb8b8b4,
  stone: 0xcfc9be,
  terrazzo: 0xdedad1,
  tileWhite: 0xe8e6df,
  grout: 0xc2beb4,
  ceramic: 0xf4f2ed,
  lampWarm: 0xffd9a8,
  sky: 0xdfe7ea,
};

/* ------------------------------ 工具 ------------------------------ */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTex(c, { srgb = false, repeat = 1, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 明度高度图 -> 切线空间法线贴图（Sobel），给木纹缝隙、布纹、瓷砖缝制造真实起伏 */
function heightToNormal(srcCanvas, strength = 2.2) {
  const S = 256;
  const c = canvas(S);
  const x = c.getContext('2d');
  x.drawImage(srcCanvas, 0, 0, S, S);
  const src = x.getImageData(0, 0, S, S).data;
  const out = new Uint8Array(S * S * 4);
  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    lum[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
  }
  const at = (px, py) => lum[((py + S) % S) * S + ((px + S) % S)];
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = (at(px + 1, py) - at(px - 1, py)) * strength;
      const dy = (at(px, py + 1) - at(px, py - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (py * S + px) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function shade(color, k) {
  const c = new THREE.Color(color);
  c.multiplyScalar(k);
  return hex(c.clone().convertLinearToSRGB().getHex());
}

/* ---------------------- 木纹（地板 / 家具） ---------------------- */
/** 每块板单独着色 + 木射线纹理 + 结疤，板缝压暗 */
export function woodCanvas({ base, seed = 7, planks = 6, vertical = false, contrast = 0.1, scale = 512 } = {}) {
  const c = canvas(scale);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = shade(base, 0.94);
  g.fillRect(0, 0, scale, scale);
  const pw = scale / planks;
  for (let i = 0; i < planks; i++) {
    const k = 1 + (r() - 0.5) * contrast * 2;
    g.save();
    if (vertical) g.translate(i * pw, 0);
    g.fillStyle = shade(base, k);
    if (vertical) g.fillRect(0, 0, pw - 1, scale);
    else g.fillRect(0, i * pw, scale, pw - 1);
    // 木射线 / 纹理线
    const lines = 30;
    for (let j = 0; j < lines; j++) {
      const t = j / lines;
      const alpha = 0.09 + r() * 0.17;
      g.strokeStyle = `rgba(84,58,30,${alpha})`;
      g.lineWidth = r() < 0.15 ? 1.6 : 0.7;
      g.beginPath();
      if (vertical) {
        let xp = i * pw + r() * pw;
        g.moveTo(xp, 0);
        for (let y = 0; y <= scale; y += 24) {
          xp += (r() - 0.5) * 7;
          g.lineTo(xp, y);
        }
      } else {
        let yp = i * pw + r() * pw;
        g.moveTo(0, yp);
        for (let x = 0; x <= scale; x += 24) {
          yp += (r() - 0.5) * 7;
          g.lineTo(x, yp);
        }
      }
      g.stroke();
    }
    // 板缝
    g.fillStyle = 'rgba(66,44,22,0.44)';
    if (vertical) g.fillRect(i * pw + pw - 2, 0, 2, scale);
    else g.fillRect(0, i * pw + pw - 2, scale, 2);
    g.restore();
  }
  // 结疤
  const knots = Math.max(1, Math.round(planks / 3));
  for (let k = 0; k < knots; k++) {
    const cx = r() * scale, cy = r() * scale, rad = 4 + r() * 9;
    const grd = g.createRadialGradient(cx, cy, 1, cx, cy, rad);
    grd.addColorStop(0, 'rgba(84,56,26,0.55)');
    grd.addColorStop(0.55, 'rgba(120,86,48,0.28)');
    grd.addColorStop(1, 'rgba(120,86,48,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
  return c;
}

/* -------------------------- 布料 / 绒毛 -------------------------- */
export function fabricCanvas({ base, seed = 21, weave = 3, contrast = 0.18, boucle = false } = {}) {
  const S = 256;
  const c = canvas(S);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = shade(base, 0.97);
  g.fillRect(0, 0, S, S);
  const step = boucle ? 4 : weave;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const over = ((x / step) + (y / step)) % 2 === 0;
      const k = 1 + (r() - 0.5) * contrast + (over ? 0.04 : -0.04);
      g.fillStyle = shade(base, k);
      g.fillRect(x, y, step - 0.6, step - 0.6);
    }
  }
  if (boucle) {
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, rad = 1.2 + r() * 2.2;
      g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.12})`;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  }
  // 绒面感：随机噪点
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ------------------------- 石材 / 水磨石 ------------------------- */
export function stoneCanvas({ base, seed = 33, veins = 7, type = 'marble' } = {}) {
  const S = 512;
  const c = canvas(S);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = hex(base);
  g.fillRect(0, 0, S, S);
  if (type === 'marble') {
    for (let v = 0; v < veins; v++) {
      g.strokeStyle = `rgba(150,146,138,${0.06 + r() * 0.16})`;
      g.lineWidth = 0.6 + r() * 3.4;
      g.beginPath();
      let x = r() * S, y = 0;
      g.moveTo(x, y);
      while (y < S) { x += (r() - 0.5) * 46; y += 14 + r() * 26; g.lineTo(x, y); }
      g.stroke();
    }
  } else if (type === 'terrazzo') {
    const cols = ['#f4f2ec', '#b9b2a4', '#8f9a8c', '#d8c2a2', '#6f6a63'];
    for (let i = 0; i < 1500; i++) {
      const x = r() * S, y = r() * S, w = 1.4 + r() * 5.5;
      g.fillStyle = cols[(r() * cols.length) | 0];
      g.globalAlpha = 0.5 + r() * 0.45;
      g.beginPath(); g.ellipse(x, y, w, w * (0.5 + r()), r() * 3.14, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  // 细颗粒
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? 255 : 90},${r() < 0.5 ? 255 : 90},${r() < 0.5 ? 250 : 84},${r() * 0.07})`;
    g.fillRect(r() * S, r() * S, 1.4, 1.4);
  }
  return c;
}

/* ---------------------------- 瓷砖 ---------------------------- */
export function tileCanvas({ base, groutCol, seed = 51, tiles = 4 } = {}) {
  const S = 512;
  const c = canvas(S);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = hex(groutCol);
  g.fillRect(0, 0, S, S);
  const tw = S / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const k = 1 + (r() - 0.5) * 0.05;
      g.fillStyle = shade(base, k);
      g.fillRect(i * tw + 3, j * tw + 3, tw - 6, tw - 6);
      const grd = g.createLinearGradient(i * tw, j * tw, (i + 1) * tw, (j + 1) * tw);
      grd.addColorStop(0, 'rgba(255,255,255,0.10)');
      grd.addColorStop(1, 'rgba(160,156,148,0.10)');
      g.fillStyle = grd;
      g.fillRect(i * tw + 3, j * tw + 3, tw - 6, tw - 6);
    }
  }
  return c;
}

/* --------------------------- 涂料墙面 --------------------------- */
export function paintCanvas(base, seed = 9) {
  const S = 256;
  const c = canvas(S);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = hex(base);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 250},${r() * 0.035})`;
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  return c;
}

/* -------------------------- 天空渐变 -------------------------- */
function skyVert() {
  return `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
}
function skyFrag() {
  return `
    uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
    void main(){
      float h = normalize(vP).y;
      vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.65))
                       : mix(mid, bot, pow(clamp(-h,0.0,1.0), 0.5));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`;
}

/* =============================== 导出 =============================== */
let MAT = null;

export function initMaterials(renderer, { srgb = true } = {}) {
  if (MAT) return MAT;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const mk = (c, o) => toTex(c, { aniso, ...o });

  // ---- 地板：浅橡木长板（5 块板并发，缝宽 1/6 板宽）----
  const floorC = woodCanvas({ base: 0xc9a97c, seed: 11, planks: 5, contrast: 0.15 });
  const floorMap = mk(floorC, { srgb, repeat: 1 });
  const floorRough = mk(woodCanvas({ base: 0xb0b0b0, seed: 11, planks: 5, contrast: 0.2 }), { repeat: 1 });
  floorRough.colorSpace = THREE.NoColorSpace;

  // ---- 家具木纹（浅橡木，细纹）----
  const furnC = woodCanvas({ base: 0xd3b88d, seed: 23, planks: 4, contrast: 0.11 });
  const furnMap = mk(furnC, { srgb });
  const furnNormal = heightToNormal(furnC, 1.1);
  furnNormal.anisotropy = aniso;

  // ---- 布艺 ----
  const greenC = fabricCanvas({ base: PALETTE.greyGreen, seed: 31 });
  const creamC = fabricCanvas({ base: PALETTE.cream, seed: 37, boucle: true });
  const linenC = fabricCanvas({ base: PALETTE.linen, seed: 41 });

  // ---- 石材 ----
  const terrazzoC = stoneCanvas({ base: PALETTE.terrazzo, seed: 61, type: 'terrazzo' });
  const marbleC = stoneCanvas({ base: PALETTE.stone, seed: 67, type: 'marble' });
  const tileC = tileCanvas({ base: PALETTE.tileWhite, groutCol: PALETTE.grout, seed: 71, tiles: 4 });
  const paintC = paintCanvas(PALETTE.wallWarm, 9);

  MAT = {
    floorWood: new THREE.MeshStandardMaterial({
      map: floorMap, roughnessMap: floorRough, roughness: 0.58, metalness: 0,
      normalMap: heightToNormal(floorC, 1.5), normalScale: new THREE.Vector2(0.45, 0.45),
      color: 0xffffff,
    }),
    floorTile: new THREE.MeshStandardMaterial({
      map: mk(tileC, { srgb }), roughness: 0.34, metalness: 0.02,
      normalMap: heightToNormal(tileC, 1.2), normalScale: new THREE.Vector2(0.22, 0.22),
    }),
    wood: new THREE.MeshStandardMaterial({
      map: furnMap, normalMap: furnNormal, normalScale: new THREE.Vector2(0.28, 0.28),
      roughness: 0.58, metalness: 0,
    }),
    woodDark: new THREE.MeshStandardMaterial({
      map: mk(woodCanvas({ base: PALETTE.oakDark, seed: 29, planks: 3, contrast: 0.08 }), { srgb }),
      roughness: 0.55, metalness: 0,
    }),
    woodTop: new THREE.MeshStandardMaterial({
      map: mk(woodCanvas({ base: PALETTE.oak, seed: 83, planks: 8, vertical: true, contrast: 0.06 }), { srgb }),
      roughness: 0.45, metalness: 0,
    }),
    fabricGreen: new THREE.MeshStandardMaterial({
      map: mk(greenC, { srgb }), normalMap: heightToNormal(greenC, 1.0),
      normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.95, metalness: 0,
    }),
    fabricCream: new THREE.MeshStandardMaterial({
      map: mk(creamC, { srgb }), normalMap: heightToNormal(creamC, 1.2),
      normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.98, metalness: 0,
    }),
    fabricLinen: new THREE.MeshStandardMaterial({
      map: mk(linenC, { srgb }), normalMap: heightToNormal(linenC, 0.9),
      normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.9, metalness: 0,
    }),
    terrazzo: new THREE.MeshStandardMaterial({
      map: mk(terrazzoC, { srgb }), roughness: 0.5, metalness: 0,
    }),
    stone: new THREE.MeshStandardMaterial({
      map: mk(marbleC, { srgb }), roughness: 0.42, metalness: 0,
    }),
    wallPaint: new THREE.MeshStandardMaterial({ map: mk(paintC, { srgb }), roughness: 0.94, metalness: 0 }),
    ceilingPaint: new THREE.MeshStandardMaterial({ color: PALETTE.ceiling, roughness: 0.97, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.44, metalness: 0.72 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.3, metalness: 0.82 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdadad6, roughness: 0.16, metalness: 0.94 }),
    ceramic: new THREE.MeshStandardMaterial({ color: PALETTE.ceramic, roughness: 0.14, metalness: 0.02 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xe4efec, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false, ior: 1.5, reflectivity: 0.35,
    }),
    screen: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.16, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.charcoal, roughness: 0.6, metalness: 0.1 }),
    rug: new THREE.MeshStandardMaterial({
      map: mk(fabricCanvas({ base: 0xb9b3a4, seed: 91, boucle: true }), { srgb }),
      normalMap: heightToNormal(fabricCanvas({ base: 0xb9b3a4, seed: 91, boucle: true }), 1.4),
      normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, metalness: 0,
    }),
    playMat: new THREE.MeshStandardMaterial({ color: 0xcfc3ab, roughness: 0.95, metalness: 0 }),
    plantLeaf: new THREE.MeshStandardMaterial({ color: 0x7fa06d, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }),
    plantLeaf2: new THREE.MeshStandardMaterial({ color: 0x93b07c, roughness: 0.66, metalness: 0, side: THREE.DoubleSide }),
    soil: new THREE.MeshStandardMaterial({ color: 0x3f3730, roughness: 1 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xefe9db, roughness: 0.9 }),
    lampShadeOff: new THREE.MeshStandardMaterial({ color: 0xf3ead9, roughness: 0.85, side: THREE.DoubleSide }),
    bulbOff: new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.4, emissive: 0x000000 }),
    artCanvas: new THREE.MeshStandardMaterial({ color: 0xf1ece1, roughness: 0.9 }),
    artFrame: new THREE.MeshStandardMaterial({ color: PALETTE.oak, roughness: 0.5 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xcfd6d6, roughness: 0.06, metalness: 0.9 }),
    ceramicTileWall: new THREE.MeshStandardMaterial({
      map: mk(tileCanvas({ base: 0xeceae3, groutCol: 0xd3cfc6, seed: 77, tiles: 6 }), { srgb }),
      roughness: 0.22, metalness: 0.02,
    }),
  };

  MAT.skyUniforms = {
    top: { value: new THREE.Color(0x7ea6c8) },
    mid: { value: new THREE.Color(0xdfe7ea) },
    bot: { value: new THREE.Color(0x8a8377) },
  };
  MAT.skyMaterial = new THREE.ShaderMaterial({
    uniforms: MAT.skyUniforms, vertexShader: skyVert(), fragmentShader: skyFrag(),
    side: THREE.BackSide, depthWrite: false, fog: false,
  });

  return MAT;
}

export const M = () => MAT;
export const materialsReady = () => !!MAT;
export const disposeMaterials = () => {
  if (!MAT) return;
  for (const v of Object.values(MAT)) if (v && v.isMaterial) v.dispose();
  MAT = null;
};
