/**
 * furniture.js —— 程序化家具库
 *
 * 每件家具都是"参数化"建模：给定 宽/深/高 生成几何体，因此同一件资产能适配
 * 三种房间方案里的不同尺寸。全部模型约定：
 *   · 原点在底面中心（y=0 为地面），正面朝 +Z；
 *   · 木纹 UV 按真实尺寸缩放（1m 一次平铺），所以不同尺寸家具木纹密度一致；
 *   · 需要发光的灯罩/灯泡标记 userData.lamp，由 lighting.js 在夜晚点亮；
 *   · meta 里记录 AABB 尺寸与是否参与碰撞，供第一人称漫游使用。
 *
 * 其中 32 件在 ASSETS 清单里登记了 GLB 名称，运行时若 assets/glb/<name>.glb
 * 存在（用 blender/build_assets.py 生成）会自动替换为 Blender 预制资产。
 */
import * as THREE from 'three';
import { M } from './materials.js';

const m = () => M();

/** 稳定的伪随机（同一件家具每次生成结果一致，切换布局不会"换书"） */
function seeded(seedStr) {
  let s = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { s ^= seedStr.charCodeAt(i); s = Math.imul(s, 16777619); }
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* ---------------------------- 几何工具 ---------------------------- */
function boxGeo(w, h, d, texScale = 1.05, ox = 0, oy = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * du * texScale + ox, uv.getY(k) * dv * texScale + oy);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function mesh(g, mat, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, mat);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}
const box = (mat, w, h, d, x, y, z) => mesh(boxGeo(w, h, d), mat, x, y, z);
const cyl = (mat, rt, rb, h, x, y, z, seg = 16) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);

/** 圆角板（软包坐垫、床垫、桌面都靠它拿质感），原点居中 */
function slabGeo(w, d, h, r = 0.05, bv = 0.022) {
  const hw = Math.max(0.01, w / 2 - bv), hd = Math.max(0.01, d / 2 - bv);
  const rr = Math.min(r, Math.min(hw, hd) - 0.001);
  const s = new THREE.Shape();
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  s.lineTo(hw, hd - rr);
  s.quadraticCurveTo(hw, hd, hw - rr, hd);
  s.lineTo(-hw + rr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  s.lineTo(-hw, -hd + rr);
  s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  const depth = Math.max(0.012, h - bv * 2);
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(h - bv * 2) / 2, 0);
  return g;
}
const slab = (mat, w, d, h, x, y, z, r, bv) => mesh(slabGeo(w, d, h, r, bv), mat, x, y, z);

const leg = (mat, x, z, h, r = 0.022, taper = 1.6) => cyl(mat, r / taper, r, h, x, h / 2, z, 12);

function tagLamp(o, on) {
  o.userData.lamp = true;
  o.userData.onColor = on.color ?? 0xffd9a8;
  o.userData.onEmissive = on.emissive ?? 1.0;
  o.userData.onIntensity = on.intensity ?? 1.0;
  o.userData.nightOnly = !!on.nightOnly;
  // 灯罩/灯泡不能投影：光源就在灯罩里面，否则会在地上烧出一个黑盘
  o.castShadow = false;
  o.receiveShadow = false;
  return o;
}

/* ------------------------------ 目录 ------------------------------ */

export const CATALOG = {

  /* ------------------------- 卧室 ------------------------- */
  bed_double: {
    name: '双人床', def: { w: 1.5, l: 2.0 }, h: 1.05,
    build(o) {
      const { w = 1.5, l = 2.0 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.woodDark, w, 0.24, l, 0, 0.22, 0));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(leg(M2.woodDark, sx * (w / 2 - 0.09), sz * (l / 2 - 0.09), 0.11)));
      g.add(slab(M2.fabricCream, w - 0.04, l - 0.04, 0.2, 0, 0.44, 0, 0.06));
      g.add(slab(M2.fabricGreen, w - 0.02, l - 0.5, 0.1, 0, 0.59, 0.24, 0.05));
      g.add(slab(M2.fabricCream, w - 0.16, 0.42, 0.14, -0.33, 0.61, -l / 2 + 0.32, 0.07));
      g.add(slab(M2.fabricCream, w - 0.16, 0.42, 0.14, 0.33, 0.61, -l / 2 + 0.32, 0.07));
      g.add(slab(M2.wood, w, 1.0, 0.07, 0, 0.6, -l / 2 - 0.02, 0.04));
      g.userData.meta = { w, d: l, h: 1.1, collide: true };
      return g;
    },
  },

  bed_single: {
    name: '单人床', def: { w: 1.2, l: 1.95 }, h: 1.0,
    build(o) {
      const { w = 1.2, l = 1.95 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.woodDark, w, 0.22, l, 0, 0.2, 0));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(leg(M2.woodDark, sx * (w / 2 - 0.08), sz * (l / 2 - 0.08), 0.1)));
      g.add(slab(M2.fabricCream, w - 0.04, l - 0.04, 0.18, 0, 0.4, 0, 0.05));
      g.add(slab(M2.fabricLinen, w - 0.02, l - 0.45, 0.09, 0, 0.53, 0.21, 0.04));
      g.add(slab(M2.fabricCream, w - 0.4, 0.4, 0.13, 0, 0.55, -l / 2 + 0.3, 0.06));
      g.add(slab(M2.wood, w, 0.9, 0.06, 0, 0.55, -l / 2 - 0.02, 0.04));
      g.userData.meta = { w, d: l, h: 1.0, collide: true };
      return g;
    },
  },

  crib: {
    name: '婴儿床', def: { w: 1.2, d: 0.66 }, h: 0.92,
    build(o) {
      const { w = 1.2, d = 0.66 } = o, M2 = m();
      const g = new THREE.Group();
      const h = 0.72;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(box(M2.wood, 0.05, h, 0.05, sx * (w / 2 - 0.03), h / 2, sz * (d / 2 - 0.03))));
      const n = Math.round(w / 0.1);
      for (let i = 0; i <= n; i++) {
        const x = -w / 2 + 0.05 + (i * (w - 0.1)) / n;
        g.add(box(M2.wood, 0.022, h - 0.1, 0.022, x, h / 2 + 0.05, -d / 2 + 0.03));
        g.add(box(M2.wood, 0.022, h - 0.1, 0.022, x, h / 2 + 0.05, d / 2 - 0.03));
      }
      const nd = Math.max(3, Math.round(d / 0.12));
      for (let i = 0; i <= nd; i++) {
        const z = -d / 2 + 0.05 + (i * (d - 0.1)) / nd;
        g.add(box(M2.wood, 0.022, h - 0.1, 0.022, w / 2 - 0.03, h / 2 + 0.05, z));
        g.add(box(M2.wood, 0.022, h - 0.1, 0.022, -w / 2 + 0.03, h / 2 + 0.05, z));
      }
      g.add(box(M2.wood, w, 0.03, 0.05, 0, h, -d / 2 + 0.03));
      g.add(box(M2.wood, w, 0.03, 0.05, 0, h, d / 2 - 0.03));
      g.add(box(M2.wood, 0.05, 0.03, d, w / 2 - 0.03, h, 0));
      g.add(box(M2.wood, 0.05, 0.03, d, -w / 2 + 0.03, h, 0));
      g.add(box(M2.woodDark, w - 0.1, 0.06, d - 0.1, 0, 0.28, 0));
      g.add(slab(M2.fabricCream, w - 0.14, d - 0.14, 0.12, 0, 0.37, 0, 0.05));
      g.userData.meta = { w, d, h: 0.92, collide: true };
      return g;
    },
  },

  nightstand: {
    name: '床头柜', def: { w: 0.45, d: 0.4, h: 0.5 }, h: 0.5,
    build(o) {
      const { w = 0.45, d = 0.4, h = 0.5 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h - 0.16, d, 0, 0.08 + (h - 0.16) / 2, 0));
      g.add(box(M2.woodTop, w + 0.02, 0.025, d + 0.02, 0, h - 0.012, 0));
      g.add(box(M2.woodDark, w - 0.06, 0.012, 0.008, 0, h - 0.3, d / 2 + 0.002));
      g.add(cyl(M2.metal, 0.012, 0.012, 0.02, w / 2 - 0.07, h - 0.3, d / 2 + 0.012, 10));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(leg(M2.woodDark, sx * (w / 2 - 0.045), sz * (d / 2 - 0.045), 0.08, 0.016, 1.2)));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  wardrobe: {
    name: '衣柜', def: { w: 2.0, d: 0.6, h: 2.2 }, h: 2.2,
    build(o) {
      const { w = 2.0, d = 0.6, h = 2.2 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h - 0.14, d - 0.04, 0, 0.07 + (h - 0.14) / 2, -0.02));
      g.add(box(M2.woodDark, w - 0.06, 0.07, d - 0.02, 0, 0.035, 0));
      const doors = w > 1.6 ? 3 : 2;
      const dw = (w - 0.04) / doors;
      for (let i = 0; i < doors; i++) {
        const x = -w / 2 + 0.02 + dw * (i + 0.5);
        g.add(box(M2.woodTop, dw - 0.012, h - 0.22, 0.02, x, 0.11 + (h - 0.22) / 2, d / 2 - 0.03));
        const hx = x + (i < doors - 1 ? dw / 2 - 0.05 : -dw / 2 + 0.05);
        g.add(box(M2.metal, 0.016, 0.42, 0.016, hx, 1.02, d / 2 - 0.008));
      }
      g.add(box(M2.woodTop, w + 0.01, 0.03, d, 0, h - 0.015, 0));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  /* ------------------------- 书房 ------------------------- */
  desk: {
    name: '书桌', def: { w: 1.4, d: 0.7, h: 0.75 }, h: 0.75,
    build(o) {
      const { w = 1.4, d = 0.7, h = 0.75, lift = false } = o, M2 = m();
      const g = new THREE.Group();
      const topT = lift ? 0.045 : 0.03;
      g.add(box(M2.woodTop, w, topT, d, 0, h - topT / 2, 0));
      if (lift) {
        g.add(box(M2.steel, 0.09, h - 0.12, 0.09, -w / 2 + 0.12, (h - 0.12) / 2 + 0.06, 0));
        g.add(box(M2.steel, 0.09, h - 0.12, 0.09, w / 2 - 0.12, (h - 0.12) / 2 + 0.06, 0));
        g.add(box(M2.steel, w - 0.3, 0.06, 0.07, 0, h - 0.09, -d / 2 + 0.12));
        g.add(box(M2.dark, 0.08, 0.03, 0.05, w / 2 - 0.12, h - 0.06, d / 2 - 0.1));
        g.add(box(M2.steel, 0.5, 0.02, 0.28, -w / 2 + 0.36, 0.06, 0));
        g.add(box(M2.steel, 0.5, 0.02, 0.28, w / 2 - 0.36, 0.06, 0));
      } else {
        g.add(box(M2.wood, 0.03, h - topT, d - 0.06, -w / 2 + 0.02, (h - topT) / 2, 0));
        g.add(box(M2.wood, 0.03, h - topT, d - 0.06, w / 2 - 0.02, (h - topT) / 2, 0));
        g.add(box(M2.wood, w - 0.1, 0.16, 0.02, 0, h - 0.24, -d / 2 + 0.04));
        g.add(box(M2.woodDark, w - 0.14, 0.22, d - 0.14, 0, h - 0.19, 0.02));
        g.add(cyl(M2.metal, 0.008, 0.008, 0.02, 0, h - 0.19, d / 2 - 0.06, 8));
      }
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  desk_chair: {
    name: '人体工学椅', def: { w: 0.62, d: 0.62, h: 1.05 }, h: 1.05,
    build(o) {
      const { w = 0.62, d = 0.62 } = o, M2 = m();
      const g = new THREE.Group();
      const seatH = 0.46;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const arm = box(M2.dark, 0.05, 0.025, 0.26, Math.sin(a) * 0.16, 0.035, Math.cos(a) * 0.16);
        arm.rotation.y = -a;
        g.add(arm);
        g.add(cyl(M2.dark, 0.022, 0.022, 0.03, Math.sin(a) * 0.28, 0.015, Math.cos(a) * 0.28, 10));
      }
      g.add(cyl(M2.steel, 0.026, 0.03, seatH - 0.06, 0, (seatH - 0.06) / 2 + 0.05, 0, 12));
      g.add(slab(M2.fabricGreen, w, d - 0.06, 0.09, 0, seatH, 0, 0.05));
      const back = slab(M2.fabricGreen, w - 0.06, 0.09, 0.62, 0, seatH + 0.34, -d / 2 + 0.04, 0.045);
      back.rotation.x = 0.12;
      g.add(back);
      g.add(box(M2.dark, 0.04, 0.3, 0.04, 0, seatH + 0.15, -d / 2 + 0.08));
      [-1, 1].forEach((s) => {
        g.add(box(M2.dark, 0.035, 0.18, 0.035, s * (w / 2 - 0.02), seatH + 0.06, -0.02));
        g.add(box(M2.dark, 0.04, 0.03, 0.22, s * (w / 2 - 0.02), seatH + 0.15, 0.06));
      });
      g.userData.meta = { w: w + 0.06, d: d + 0.06, h: 1.05, collide: true };
      return g;
    },
  },

  monitor: {
    name: '显示器', def: { w: 0.62 }, h: 0.5,
    build(o) {
      const { w = 0.62 } = o, M2 = m();
      const g = new THREE.Group();
      const h = w * 0.58;
      g.add(box(M2.dark, w, h, 0.022, 0, h / 2 + 0.13, 0));
      g.add(box(M2.screen, w - 0.02, h - 0.02, 0.004, 0, h / 2 + 0.13, 0.013));
      g.add(box(M2.metal, 0.05, 0.16, 0.03, 0, 0.09, -0.01));
      g.add(cyl(M2.metal, 0.1, 0.11, 0.018, 0, 0.012, -0.01, 20));
      g.userData.meta = { w, d: 0.16, h: h + 0.13, collide: false };
      return g;
    },
  },

  pegboard: {
    name: '洞洞板', def: { w: 1.2, h: 0.72 }, h: 0.72,
    build(o) {
      const { w = 1.2, h = 0.72 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.woodTop, w, h, 0.014, 0, 0, 0));
      const nx = Math.round(w / 0.08), ny = Math.round(h / 0.08);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8), M2.dark,
          -w / 2 + 0.04 + (i * (w - 0.08)) / (nx - 1), -h / 2 + 0.04 + (j * (h - 0.08)) / (ny - 1), 0.014));
      }
      for (let i = 0; i < 4; i++) g.add(box(M2.dark, 0.06, 0.006, 0.006, -w / 2 + 0.1 + i * 0.12, h / 2 - 0.06, 0.03));
      g.add(box(M2.wood, w * 0.5, 0.02, 0.1, w * 0.2, -h / 2 + 0.06, 0.06));
      g.userData.meta = { w, d: 0.16, h, collide: false, mount: true };
      return g;
    },
  },

  bookshelf: {
    name: '书架', def: { w: 1.0, d: 0.32, h: 1.8 }, h: 1.8,
    build(o) {
      const { w = 1.0, d = 0.32, h = 1.8 } = o, M2 = m();
      const g = new THREE.Group();
      [-1, 1].forEach((s) => g.add(box(M2.wood, 0.025, h, d, s * (w / 2 - 0.012), h / 2, 0)));
      g.add(box(M2.wood, w - 0.05, 0.02, d, 0, h - 0.01, 0));
      g.add(box(M2.wood, w - 0.05, 0.02, d, 0, 0.012, 0));
      const rnd = seeded(`books-${w}-${h}`);
      const shelves = 4;
      const bookColors = [0xb9ad96, 0x8f9a8c, 0xa8634f, 0x6d7385, 0xd8c9ac];
      const bookMats = bookColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
      for (let i = 1; i <= shelves; i++) {
        const y = (h / (shelves + 1)) * i;
        g.add(box(M2.wood, w - 0.05, 0.02, d - 0.02, 0, y, 0));
        let x = -w / 2 + 0.05;
        while (x < w / 2 - 0.09) {
          const bw = 0.02 + rnd() * 0.035, bh = 0.16 + rnd() * 0.1;
          g.add(box(bookMats[(rnd() * bookMats.length) | 0],
            bw, bh, d - 0.09, x + bw / 2, y + 0.01 + bh / 2, 0));
          x += bw + 0.006;
        }
      }
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  filing_cabinet: {
    name: '文件柜', def: { w: 0.42, d: 0.5, h: 0.62 }, h: 0.62,
    build(o) {
      const { w = 0.42, d = 0.5, h = 0.62 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h - 0.1, d, 0, 0.05 + (h - 0.1) / 2, 0));
      g.add(box(M2.woodTop, w + 0.015, 0.025, d + 0.015, 0, h - 0.012, 0));
      for (let i = 0; i < 2; i++) {
        g.add(box(M2.woodTop, w - 0.05, (h - 0.16) / 2 - 0.012, 0.02, 0, 0.14 + i * ((h - 0.16) / 2 + 0.005), d / 2 - 0.02));
        g.add(box(M2.metal, w - 0.2, 0.014, 0.014, 0, 0.14 + i * ((h - 0.16) / 2 + 0.005), d / 2 - 0.006));
      }
      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) =>
        g.add(leg(M2.metal, sx * (w / 2 - 0.04), sz * (d / 2 - 0.04), 0.05, 0.012))));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  /* ------------------------- 客厅 / 单椅 ------------------------- */
  armchair: {
    name: '单人沙发', def: { w: 0.78, d: 0.82, h: 0.76 }, h: 0.76,
    build(o) {
      const { w = 0.78, d = 0.82, h = 0.76 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(slab(M2.fabricGreen, w, d, 0.2, 0, 0.33, 0, 0.07));
      const back = slab(M2.fabricGreen, w, 0.16, h - 0.24, 0, h - (h - 0.24) / 2 - 0.06, -d / 2 + 0.09, 0.06);
      back.rotation.x = 0.14;
      g.add(back);
      [-1, 1].forEach((s) => g.add(slab(M2.fabricGreen, 0.13, d - 0.1, 0.22, s * (w / 2 - 0.065), 0.44, 0.02, 0.05)));
      g.add(slab(M2.fabricCream, w - 0.2, d - 0.22, 0.11, 0, 0.47, 0.05, 0.05));
      g.add(slab(M2.fabricCream, w - 0.28, 0.12, 0.34, 0, 0.62, -d / 2 + 0.22, 0.05));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(leg(M2.woodDark, sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), 0.16, 0.024, 1.5)));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  sofa_3seat: {
    name: '三人沙发', def: { w: 2.1, d: 0.92, h: 0.78 }, h: 0.78,
    build(o) { return sofa(o, 3); },
  },
  sofa_2seat: {
    name: '双人沙发', def: { w: 1.5, d: 0.92, h: 0.78 }, h: 0.78,
    build(o) { return sofa(o, 2); },
  },
  sofa_bed: {
    name: '沙发床', def: { w: 1.5, d: 0.95, h: 0.78 }, h: 0.78,
    build(o) { return sofa({ ...o }, 1, true); },
  },

  coffee_table: {
    name: '茶几', def: { w: 1.1, d: 0.55, h: 0.4 }, h: 0.4,
    build(o) {
      const { w = 1.1, d = 0.55, h = 0.4 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.woodTop, w, 0.03, d, 0, h - 0.015, 0));
      g.add(box(M2.wood, w - 0.12, 0.02, d - 0.12, 0, 0.14, 0));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(leg(M2.woodDark, sx * (w / 2 - 0.05), sz * (d / 2 - 0.05), h - 0.03, 0.02, 1.7)));
      g.add(cyl(M2.ceramic, 0.05, 0.06, 0.09, w * 0.22, h + 0.045, 0, 14));
      g.add(box(M2.paper, 0.2, 0.02, 0.15, -w * 0.2, h + 0.02, 0.02));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  side_table: {
    name: '边几', def: { w: 0.45, d: 0.45, h: 0.52 }, h: 0.52,
    build(o) {
      const { w = 0.45, d = 0.45, h = 0.52 } = o, M2 = m();
      const g = new THREE.Group();
      if (w < 0.35) { // 窄边柜（走廊）
        g.add(box(M2.wood, w, h - 0.12, w, 0, 0.06 + (h - 0.12) / 2, 0));
        g.add(box(M2.woodTop, w + 0.02, 0.025, w + 0.02, 0, h - 0.012, 0));
        g.add(cyl(M2.metal, 0.01, 0.01, 0.012, 0, h - 0.28, w / 2 + 0.006, 8));
        g.add(cyl(M2.ceramic, 0.045, 0.05, 0.14, 0, h + 0.07, 0, 14));
        g.userData.meta = { w, d: w, h: h + 0.15, collide: true };
        return g;
      }
      g.add(cyl(M2.stone, w / 2, w / 2, 0.03, 0, h - 0.015, 0, 24));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        g.add(leg(M2.metal, Math.sin(a) * (w / 2 - 0.05), Math.cos(a) * (w / 2 - 0.05), h - 0.03, 0.014, 1.2));
      }
      g.add(cyl(M2.ceramic, 0.04, 0.05, 0.16, 0, h + 0.08, 0, 14));
      g.userData.meta = { w, d: w, h, collide: true };
      return g;
    },
  },

  tv_console: {
    name: '电视柜', def: { w: 1.8, d: 0.42, h: 0.45 }, h: 0.45,
    build(o) {
      const { w = 1.8, d = 0.42, h = 0.45 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h - 0.16, d, 0, 0.08 + (h - 0.16) / 2, 0));
      g.add(box(M2.woodTop, w + 0.02, 0.03, d + 0.02, 0, h - 0.015, 0));
      const n = w > 1.5 ? 3 : 2, dw = (w - 0.06) / n;
      for (let i = 0; i < n; i++) {
        g.add(box(M2.woodTop, dw - 0.01, h - 0.22, 0.018, -w / 2 + 0.03 + dw * (i + 0.5), 0.11 + (h - 0.22) / 2, d / 2 - 0.03));
        g.add(box(M2.metal, dw * 0.35, 0.012, 0.012, -w / 2 + 0.03 + dw * (i + 0.5), h - 0.12, d / 2 - 0.006));
      }
      g.add(box(M2.woodDark, w - 0.1, 0.12, d - 0.06, 0, 0.06, 0));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(leg(M2.metal, sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), 0.06, 0.014)));
      g.add(cyl(M2.ceramic, 0.055, 0.065, 0.12, w * 0.3, h + 0.075, 0, 14));
      g.add(box(M2.dark, 0.16, 0.09, 0.11, -w * 0.28, h + 0.06, 0));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  tv: {
    name: '电视', def: { w: 1.3, h: 0.74, d: 0.05 }, h: 0.74,
    build(o) {
      const { w = 1.3, h = 0.74 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.dark, w, h, 0.035, 0, 0, 0));
      g.add(box(M2.screen, w - 0.014, h - 0.014, 0.006, 0, 0, 0.021));
      g.add(box(M2.dark, w, 0.02, 0.04, 0, -h / 2 + 0.01, 0.02));
      g.userData.meta = { w, d: 0.08, h, collide: false, mount: true };
      return g;
    },
  },

  /* ------------------------- 餐厅 ------------------------- */
  dining_table: {
    name: '餐桌', def: { w: 1.4, d: 0.8, h: 0.75 }, h: 0.75,
    build(o) {
      const { w = 1.4, d = 0.8, h = 0.75 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.woodTop, w, 0.04, d, 0, h - 0.02, 0));
      g.add(box(M2.wood, w - 0.3, 0.05, d - 0.3, 0, h - 0.07, 0));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const l = leg(M2.woodDark, sx * (w / 2 - 0.09), sz * (d / 2 - 0.09), h - 0.04, 0.028, 2.1);
        l.rotation.z = sx * 0.03;
        g.add(l);
      });
      g.add(box(M2.wood, w - 0.24, 0.025, 0.025, 0, 0.22, 0));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  dining_chair: {
    name: '餐椅', def: { w: 0.46, d: 0.5, h: 0.84 }, h: 0.84,
    build(o) {
      const { w = 0.46, d = 0.5, child = false } = o, M2 = m();
      const g = new THREE.Group();
      const sh = child ? 0.36 : 0.45, bh = child ? 0.28 : 0.42;
      g.add(box(M2.woodTop, w, 0.035, d, 0, sh - 0.018, 0));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const l = leg(M2.wood, sx * (w / 2 - 0.035), sz * (d / 2 - 0.04), sh - 0.035, 0.019, 1.6);
        l.rotation.z = sx * 0.02;
        l.rotation.x = sz * 0.02;
        g.add(l);
      });
      [-1, 1].forEach((s) => {
        g.add(box(M2.wood, 0.025, bh, 0.025, s * (w / 2 - 0.035), sh + bh / 2 - 0.02, -d / 2 + 0.035));
      });
      g.add(box(M2.wood, w - 0.05, 0.06, 0.022, 0, sh + bh - 0.02, -d / 2 + 0.035));
      g.add(box(M2.wood, w - 0.09, 0.03, 0.02, 0, sh + bh * 0.5, -d / 2 + 0.035));
      if (child) {
        g.add(box(M2.fabricCream, w - 0.04, 0.03, d - 0.06, 0, sh + 0.02, 0));
        g.add(box(M2.wood, w, 0.03, 0.02, 0, sh + 0.06, d / 2 - 0.02));
      }
      g.userData.meta = { w, d, h: sh + bh, collide: true };
      return g;
    },
  },

  sideboard: {
    name: '餐边柜', def: { w: 1.2, d: 0.42, h: 0.8 }, h: 0.8,
    build(o) {
      const { w = 1.2, d = 0.42, h = 0.8 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h - 0.2, d, 0, 0.12 + (h - 0.2) / 2, 0));
      g.add(box(M2.woodTop, w + 0.02, 0.03, d + 0.02, 0, h - 0.015, 0));
      [-1, 1].forEach((s) => g.add(box(M2.woodTop, w / 2 - 0.03, h - 0.26, 0.02, s * w / 4, 0.12 + (h - 0.2) / 2, d / 2 - 0.025)));
      g.add(box(M2.metal, w * 0.22, 0.014, 0.014, -0.12, h - 0.24, d / 2 - 0.004));
      g.add(box(M2.metal, w * 0.22, 0.014, 0.014, 0.12, h - 0.24, d / 2 - 0.004));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(leg(M2.woodDark, sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), 0.12, 0.02, 1.9)));
      // 摆件
      g.add(cyl(M2.ceramic, 0.05, 0.07, 0.22, -w * 0.3, h + 0.1, 0, 16));
      g.add(box(M2.paper, 0.14, 0.2, 0.06, w * 0.3, h + 0.11, 0));
      for (let i = 0; i < 2; i++) g.add(box(M2.wood, 0.02, 0.12, 0.02, w * 0.3, h + 0.18, -0.02 + i * 0.04));
      g.userData.meta = { w, d, h: h + 0.25, collide: true };
      return g;
    },
  },

  /* ------------------------- 玄关 / 家政 ------------------------- */
  shoe_cabinet: {
    name: '鞋柜', def: { w: 1.2, d: 0.35, h: 1.1 }, h: 1.1,
    build(o) {
      const { w = 1.2, d = 0.35, h = 1.1 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h - 0.16, d, 0, 0.08 + (h - 0.16) / 2, 0));
      g.add(box(M2.woodTop, w + 0.015, 0.03, d + 0.015, 0, h - 0.015, 0));
      for (let i = 0; i < 3; i++) {
        const dw = (w - 0.05) / 2;
        const y = 0.14 + i * ((h - 0.28) / 3);
        [-1, 1].forEach((s) => {
          g.add(box(M2.woodTop, dw - 0.012, (h - 0.28) / 3 - 0.012, 0.018, s * w / 4, y + (h - 0.28) / 6, d / 2 - 0.02));
        });
        g.add(box(M2.metal, 0.012, 0.1, 0.012, -0.03, y + (h - 0.28) / 6, d / 2 - 0.008));
        g.add(box(M2.metal, 0.012, 0.1, 0.012, 0.03, y + (h - 0.28) / 6, d / 2 - 0.008));
      }
      g.add(box(M2.woodDark, w - 0.08, 0.07, d - 0.02, 0, 0.035, 0));
      g.add(cyl(M2.ceramic, 0.05, 0.06, 0.14, -w * 0.3, h + 0.08, 0, 14));
      g.add(box(M2.steel, 0.12, 0.05, 0.1, w * 0.32, h + 0.035, 0));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  bench: {
    name: '换鞋凳', def: { w: 0.9, d: 0.38, h: 0.42 }, h: 0.42,
    build(o) {
      const { w = 0.9, d = 0.38, h = 0.42 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(slab(M2.fabricLinen, w, d, 0.1, 0, h - 0.05, 0, 0.04));
      g.add(box(M2.wood, w - 0.03, 0.03, d - 0.03, 0, h - 0.115, 0));
      [-1, 1].forEach((s) => {
        g.add(box(M2.wood, 0.03, h - 0.13, d - 0.04, s * (w / 2 - 0.03), (h - 0.13) / 2, 0));
        g.add(box(M2.wood, 0.03, 0.025, d - 0.06, s * (w / 2 - 0.03), 0.3, 0));
      });
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  coat_rack: {
    name: '衣帽架', def: { w: 0.35, d: 0.35, h: 1.72 }, h: 1.72,
    build(o) {
      const { w = 0.35, d = 0.35, h = 1.72 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(cyl(M2.wood, 0.11, 0.12, 0.025, 0, 0.012, 0, 20));
      g.add(cyl(M2.metal, 0.021, 0.024, h - 0.02, 0, h / 2, 0, 14));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const arm = cyl(M2.wood, 0.012, 0.014, 0.16, 0, h - 0.16, 0, 8);
        arm.position.set(Math.sin(a) * 0.08, h - 0.16, Math.cos(a) * 0.08);
        arm.rotation.z = Math.cos(a) * 0.9;
        arm.rotation.x = -Math.sin(a) * 0.9;
        g.add(arm);
        g.add(cyl(M2.wood, 0.016, 0.016, 0.02, Math.sin(a) * 0.16, h - 0.06, Math.cos(a) * 0.16, 10));
      }
      g.add(cyl(M2.wood, 0.09, 0.09, 0.02, 0, h + 0.01, 0, 18));
      g.add(mesh(slabGeo(0.26, 0.26, 0.03, 0.1), M2.wood, 0, h + 0.035, 0));
      g.userData.meta = { w, d, h: h + 0.05, collide: true };
      return g;
    },
  },

  washer: {
    name: '洗衣机', def: { w: 0.6, d: 0.62, h: 0.86 }, h: 0.86,
    build(o) {
      const { w = 0.6, d = 0.62, h = 0.86 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.ceramic, w, h, d, 0, h / 2, 0));
      g.add(box(M2.metal, w, 0.05, d, 0, h - 0.025, 0));
      const door = cyl(M2.dark, 0.21, 0.21, 0.03, 0, h * 0.46, d / 2 + 0.008, 26);
      door.rotation.x = Math.PI / 2;
      g.add(door);
      const glassDoor = cyl(M2.glass, 0.175, 0.175, 0.012, 0, h * 0.46, d / 2 + 0.026, 26);
      glassDoor.rotation.x = Math.PI / 2;
      g.add(glassDoor);
      g.add(cyl(M2.metal, 0.185, 0.185, 0.01, 0, h * 0.46, d / 2 + 0.02, 26));
      g.add(box(M2.dark, w - 0.06, 0.09, 0.01, 0, h - 0.09, d / 2 + 0.002));
      for (let i = 0; i < 3; i++) g.add(cyl(M2.ceramic, 0.014, 0.014, 0.014, w / 2 - 0.07 - i * 0.05, h - 0.09, d / 2 + 0.012, 12));
      g.add(box(M2.steel, 0.3, 0.03, 0.005, 0, h - 0.06, d / 2 + 0.004));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  /* ------------------------- 厨房 ------------------------- */
  kitchen_counter: {
    name: '橱柜地柜', def: { w: 1.3, d: 0.6 }, h: 0.86,
    build(o) {
      const { w = 1.3, d = 0.6 } = o, M2 = m();
      const g = new THREE.Group();
      const H = 0.86;
      g.add(box(M2.wood, w, H - 0.14, d - 0.05, 0, 0.1 + (H - 0.14) / 2, -0.025));
      g.add(box(M2.dark, w - 0.06, 0.1, d - 0.16, 0, 0.05, -0.05));
      g.add(slab(M2.terrazzo, w + 0.01, d + 0.01, 0.04, 0, H - 0.02, 0, 0.012, 0.008));
      g.add(box(M2.woodDark, w, 0.025, 0.02, 0, H - 0.05, d / 2 - 0.06));
      const n = Math.max(1, Math.round(w / 0.6));
      const dw = (w - 0.02) / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.01 + dw * (i + 0.5);
        g.add(box(M2.woodTop, dw - 0.01, H - 0.26, 0.018, x, 0.16 + (H - 0.26) / 2, d / 2 - 0.035));
        g.add(box(M2.metal, dw * 0.4, 0.012, 0.012, x, H - 0.2, d / 2 - 0.02));
      }
      g.userData.meta = { w, d, h: H, collide: true };
      return g;
    },
  },

  sink: {
    name: '水槽', def: { w: 0.62, d: 0.44 }, h: 0.2,
    build(o) {
      const { w = 0.62, d = 0.44 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.steel, w, 0.012, d, 0, 0.002, 0));
      g.add(box(M2.dark, w - 0.05, 0.13, d - 0.05, 0, -0.045, 0));
      g.add(box(M2.steel, w - 0.06, 0.008, d - 0.06, 0, -0.108, 0));
      g.add(cyl(M2.chrome, 0.018, 0.018, 0.26, w / 2 - 0.07, 0.13, -d / 2 + 0.05, 14));
      const spout = cyl(M2.chrome, 0.014, 0.014, 0.2, w / 2 - 0.14, 0.25, -d / 2 + 0.05, 12);
      spout.rotation.z = Math.PI / 2;
      g.add(spout);
      g.add(cyl(M2.chrome, 0.012, 0.012, 0.04, w / 2 - 0.22, 0.23, -d / 2 + 0.05, 10));
      g.add(cyl(M2.chrome, 0.01, 0.01, 0.09, w / 2 - 0.07, 0.2, d / 2 - 0.16, 10));
      g.userData.meta = { w, d, h: 0.28, collide: false };
      return g;
    },
  },

  stove: {
    name: '燃气灶', def: { w: 0.6, d: 0.5 }, h: 0.1,
    build(o) {
      const { w = 0.6, d = 0.5 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.screen, w, 0.02, d, 0, 0.012, 0));
      g.add(box(M2.steel, w - 0.01, 0.006, d - 0.01, 0, 0.025, 0));
      [-1, 1].forEach((s) => {
        g.add(mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 22), M2.dark, s * w * 0.22, 0.035, 0, 0));
        g.add(mesh(new THREE.TorusGeometry(0.05, 0.01, 8, 20), M2.steel, s * w * 0.22, 0.045, 0, 0));
        g.add(cyl(M2.steel, 0.022, 0.028, 0.02, s * w * 0.22, 0.045, 0, 14));
      });
      for (let i = 0; i < 2; i++) g.add(cyl(M2.metal, 0.018, 0.018, 0.02, -0.1 + i * 0.2, 0.035, d / 2 - 0.03, 12));
      g.userData.meta = { w, d, h: 0.06, collide: false };
      return g;
    },
  },

  range_hood: {
    name: '油烟机', def: { w: 0.6, d: 0.52, h: 0.62 }, h: 0.62,
    build(o) {
      const { w = 0.6, d = 0.52, h = 0.62 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.steel, w, 0.08, d, 0, -h / 2 + 0.04, 0));
      g.add(box(M2.steel, w * 0.42, h - 0.2, d * 0.5, 0, h / 2 - 0.1, -d * 0.18));
      g.add(box(M2.dark, w - 0.06, 0.02, d - 0.1, 0, -h / 2 + 0.09, 0));
      g.add(box(M2.metal, w * 0.7, 0.014, 0.03, 0, -h / 2 + 0.1, -d / 2 + 0.06));
      [-1, 1].forEach((s) => g.add(cyl(M2.metal, 0.012, 0.012, 0.03, s * 0.16, -h / 2 + 0.105, -d / 2 + 0.06, 10)));
      const strip = box(M2.bulbOff.clone(), w * 0.5, 0.008, 0.02, 0, -h / 2 + 0.086, d * 0.12);
      tagLamp(strip, { color: 0xfff0d0, emissive: 0.8 });
      g.add(strip);
      g.userData.meta = { w, d, h, collide: false, mount: true };
      return g;
    },
  },

  fridge: {
    name: '冰箱', def: { w: 0.6, d: 0.65, h: 1.85 }, h: 1.85,
    build(o) {
      const { w = 0.6, d = 0.65, h = 1.85 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.steel, w, h, d, 0, h / 2, 0));
      g.add(box(M2.ceramic, w - 0.02, h * 0.62, d - 0.02, 0, h * 0.31 + 0.02, 0.012));
      g.add(box(M2.ceramic, w - 0.02, h * 0.34, d - 0.02, 0, h * 0.83, 0.012));
      g.add(box(M2.dark, w, 0.012, d - 0.01, 0, h * 0.65, 0.02));
      [-1, 1].forEach((s) => g.add(box(M2.metal, 0.02, h * (s < 0 ? 0.34 : 0.17), 0.02,
        s < 0 ? -0.2 : 0.2, s < 0 ? h * 0.83 : h * 0.2, d / 2 + 0.02)));
      g.add(box(M2.dark, w - 0.06, 0.014, 0.01, 0, h - 0.04, d / 2 + 0.006));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  wall_cabinet: {
    name: '吊柜', def: { w: 0.6, d: 0.36, h: 0.7 }, h: 0.7,
    build(o) {
      const { w = 0.6, d = 0.36, h = 0.7 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h, d - 0.02, 0, 0, 0));
      g.add(box(M2.woodTop, w - 0.03, h - 0.05, 0.018, 0, 0, d / 2 - 0.02));
      g.add(box(M2.woodTop, w - 0.03, h - 0.05, 0.018, 0, 0, d / 2 - 0.02));
      g.add(box(M2.metal, w * 0.28, 0.012, 0.012, w * 0.18, -h * 0.28, d / 2 - 0.008));
      g.userData.meta = { w, d, h, collide: false, mount: true };
      return g;
    },
  },

  /* ------------------------- 卫生间 ------------------------- */
  toilet: {
    name: '马桶', def: { w: 0.68, d: 0.7 }, h: 0.78,
    build(o) {
      const { w = 0.68, d = 0.7 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.ceramic, w, 0.42, d * 0.42, 0, 0.21, -d / 2 + d * 0.22));
      const bowl = mesh(new THREE.CylinderGeometry(w * 0.46, w * 0.3, 0.36, 22), M2.ceramic, 0, 0.2, d * 0.1);
      bowl.scale.set(1, 1, 1.24);
      g.add(bowl);
      g.add(mesh(slabGeo(w * 0.98, d * 0.68, 0.06, 0.16), M2.ceramic, 0, 0.42, d * 0.08));
      g.add(mesh(new THREE.TorusGeometry(w * 0.4, 0.018, 8, 24), M2.ceramic, 0, 0.44, d * 0.08, 0));
      g.add(box(M2.ceramic, w * 0.9, 0.5, 0.17, 0, 0.53, -d / 2 + 0.085));
      g.add(box(M2.ceramic, w * 0.92, 0.03, 0.19, 0, 0.79, -d / 2 + 0.09));
      g.add(box(M2.steel, 0.1, 0.012, 0.03, 0, 0.79, -d / 2 + 0.185));
      g.userData.meta = { w, d, h: 0.8, collide: true };
      return g;
    },
  },

  vanity: {
    name: '浴室柜', def: { w: 0.8, d: 0.45, h: 0.85 }, h: 1.35,
    build(o) {
      const { w = 0.8, d = 0.45, h = 0.85 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h - 0.2, d, 0, 0.12 + (h - 0.2) / 2, 0));
      g.add(slab(M2.stone, w + 0.02, d + 0.02, 0.04, 0, h - 0.02, 0, 0.012, 0.008));
      const basin = mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.26, 0.16, 22), M2.ceramic, 0, h + 0.06, 0.02);
      g.add(basin);
      g.add(mesh(new THREE.TorusGeometry(w * 0.33, 0.012, 8, 24), M2.ceramic, 0, h + 0.14, 0.02, 0));
      g.add(cyl(M2.chrome, 0.015, 0.015, 0.2, 0, h + 0.14, -d / 2 + 0.09, 14));
      const sp = cyl(M2.chrome, 0.012, 0.012, 0.13, 0, h + 0.24, -d / 2 + 0.155, 12);
      sp.rotation.x = Math.PI / 2;
      g.add(sp);
      [-1, 1].forEach((s) => {
        g.add(box(M2.woodTop, w / 2 - 0.03, h - 0.3, 0.018, s * w / 4, 0.15 + (h - 0.3) / 2, d / 2 - 0.025));
        g.add(box(M2.metal, 0.012, 0.1, 0.012, s * 0.04, h - 0.22, d / 2 - 0.008));
      });
      g.add(box(M2.woodDark, w - 0.08, 0.1, d - 0.1, 0, 0.07, -0.02));
      g.userData.meta = { w, d, h, collide: true };
      return g;
    },
  },

  shower: {
    name: '淋浴房', def: { w: 0.9, d: 0.9, h: 2.0 }, h: 2.0,
    build(o) {
      const { w = 0.9, d = 0.9, h = 2.0 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(slab(M2.ceramic, w, d, 0.06, 0, 0.03, 0, 0.02));
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), M2.steel, 0, 0.075, 0));
      const gz = (len, x, z, rotY) => {
        const p = box(M2.glass, len, h - 0.12, 0.012, x, (h - 0.12) / 2 + 0.06, z);
        p.userData.noShadow = true;
        p.rotation.y = rotY;
        return p;
      };
      g.add(gz(d - 0.02, -w / 2 + 0.006, 0, Math.PI / 2));
      g.add(gz(w - 0.02, 0, d / 2 - 0.006, 0));
      g.add(box(M2.steel, 0.022, h, 0.022, -w / 2 + 0.011, h / 2, -d / 2 + 0.011));
      g.add(box(M2.steel, 0.022, 0.03, d - 0.02, -w / 2 + 0.011, h - 0.02, 0));
      g.add(box(M2.steel, 0.022, h, 0.022, -w / 2 + 0.011, h / 2, d / 2 - 0.011));
      g.add(box(M2.steel, 0.022, h, 0.022, w / 2 - 0.011, h / 2, d / 2 - 0.011));
      g.add(box(M2.steel, 0.022, 0.03, d - 0.02, w / 2 - 0.011, h - 0.02, 0));
      const door = box(M2.glass, (w - 0.05) * 0.52, h - 0.4, 0.012, -w / 2 + 0.14, (h - 0.4) / 2 + 0.1, d / 2 - 0.02);
      door.userData.noShadow = true;
      g.add(door);
      g.add(cyl(M2.chrome, 0.014, 0.014, 0.36, -w / 2 + 0.24, h - 0.5, d / 2 + 0.025, 12));
      g.add(box(M2.chrome, 0.03, 0.03, 0.05, -w / 2 + 0.24, h - 0.5, d / 2 + 0.04));
      g.add(cyl(M2.chrome, 0.016, 0.016, 0.5, w / 2 - 0.24, h - 0.55, -d / 2 + 0.06, 12));
      const head = cyl(M2.chrome, 0.09, 0.07, 0.03, w / 2 - 0.24, h - 0.28, -d / 2 + 0.1, 20);
      head.rotation.x = 0.35;
      g.add(head);
      g.add(box(M2.steel, w - 0.14, 0.02, 0.02, 0, 1.15, -d / 2 + 0.06));
      g.userData.meta = { w, d, h: h - 0.1, collide: true };
      return g;
    },
  },

  mirror_cabinet: {
    name: '镜柜', def: { w: 0.8, h: 0.8, d: 0.14 }, h: 0.8,
    build(o) {
      const { w = 0.8, h = 0.8, d = 0.14 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.wood, w, h, d, 0, 0, 0));
      [-1, 1].forEach((s) => {
        g.add(box(M2.mirror, w / 2 - 0.02, h - 0.04, 0.01, s * w / 4, 0, d / 2 + 0.006));
        g.add(box(M2.metal, 0.012, 0.12, 0.012, s * 0.03, h * 0.1, d / 2 + 0.016));
      });
      const strip = box(M2.bulbOff.clone(), w * 0.8, 0.012, 0.02, 0, -h / 2 + 0.02, d / 2 + 0.01);
      tagLamp(strip, { color: 0xf6f2e8, emissive: 0.55 });
      g.add(strip);
      g.userData.meta = { w, d, h, collide: false, mount: true };
      return g;
    },
  },

  /* ------------------------- 儿童房 ------------------------- */
  changing_table: {
    name: '尿布台', def: { w: 0.9, d: 0.55, h: 0.92 }, h: 0.92,
    build(o) {
      const { w = 0.9, d = 0.55, h = 0.92 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.woodTop, w, 0.03, d, 0, h - 0.015, 0));
      g.add(slab(M2.fabricCream, w - 0.06, d - 0.06, 0.05, 0, h + 0.02, 0, 0.03));
      g.add(box(M2.wood, w - 0.06, 0.14, 0.02, 0, h + 0.09, -d / 2 + 0.02));
      [-1, 1].forEach((s) => g.add(box(M2.wood, 0.02, 0.14, d - 0.06, s * (w / 2 - 0.01), h + 0.09, 0)));
      for (let i = 1; i <= 2; i++) g.add(box(M2.woodTop, w - 0.08, 0.025, d - 0.06, 0, 0.24 * i + 0.12, 0));
      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) =>
        g.add(leg(M2.woodDark, sx * (w / 2 - 0.05), sz * (d / 2 - 0.05), h - 0.03, 0.019, 1.4))));
      g.add(box(M2.woodDark, w - 0.1, 0.1, d - 0.06, 0, 0.07, 0));
      g.userData.meta = { w, d, h: h + 0.2, collide: true };
      return g;
    },
  },

  rocking_chair: {
    name: '摇椅', def: { w: 0.72, d: 0.82, h: 0.86 }, h: 0.86,
    build(o) {
      const { w = 0.72, d = 0.82 } = o, M2 = m();
      const g = new THREE.Group();
      [-1, 1].forEach((s) => {
        const rock = mesh(new THREE.TorusGeometry(d * 0.45, 0.018, 8, 28, Math.PI * 0.7), M2.woodDark, s * (w / 2 - 0.04), 0.1, 0, 0);
        rock.rotation.x = Math.PI / 2;
        rock.rotation.z = Math.PI * 0.15;
        g.add(rock);
        g.add(box(M2.wood, 0.03, 0.42, 0.03, s * (w / 2 - 0.04), 0.36, -0.16));
        g.add(box(M2.wood, 0.03, 0.3, 0.03, s * (w / 2 - 0.04), 0.3, 0.18));
      });
      g.add(slab(M2.fabricGreen, w, d - 0.18, 0.09, 0, 0.5, 0.02, 0.045));
      const back = slab(M2.fabricGreen, w, 0.1, 0.42, 0, 0.74, -d / 2 + 0.16, 0.05);
      back.rotation.x = -0.25;
      g.add(back);
      [-1, 1].forEach((s) => g.add(box(M2.wood, 0.035, 0.03, 0.36, s * (w / 2 - 0.04), 0.6, 0.0)));
      g.userData.meta = { w, d, h: 0.9, collide: true };
      return g;
    },
  },

  toy_bin: {
    name: '玩具收纳筐', def: { w: 0.46, d: 0.46, h: 0.5 }, h: 0.5,
    build(o) {
      const { w = 0.46, d = 0.46, h = 0.5 } = o, M2 = m();
      const g = new THREE.Group();
      const b = mesh(new THREE.CylinderGeometry(w / 2, w / 2 * 0.86, h, 18, 1, true), M2.fabricLinen, 0, h / 2, 0);
      b.material = M2.fabricLinen;
      b.material.side = THREE.DoubleSide;
      g.add(b);
      g.add(mesh(new THREE.CylinderGeometry(w / 2 * 0.86, w / 2 * 0.86, 0.02, 18), M2.fabricLinen, 0, 0.01, 0));
      g.add(mesh(new THREE.TorusGeometry(w / 2, 0.014, 6, 20), M2.fabricLinen, 0, h, 0, 0));
      g.add(mesh(new THREE.TorusGeometry(w * 0.3, 0.01, 6, 16), M2.fabricLinen, 0, h * 0.6, 0, 0));
      [-1, 1].forEach((s) => g.add(slab(M2.fabricCream, 0.09, 0.09, 0.03, s * w * 0.34, h * 0.62, 0, 0.02)));
      g.userData.meta = { w, d: w, h, collide: true };
      return g;
    },
  },

  growth_chart: {
    name: '成长尺', def: { w: 0.24, h: 1.5 }, h: 1.5,
    build(o) {
      const { w = 0.24, h = 1.5 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.woodTop, w, h, 0.016, 0, 0, 0));
      const n = 15;
      for (let i = 1; i < n; i++) {
        const y = h / 2 - (i * h) / n;
        const long = i % 5 === 0;
        g.add(box(M2.dark, long ? w * 0.5 : w * 0.28, 0.012, 0.006, -w / 2 + (long ? w * 0.25 + 0.02 : w * 0.14 + 0.02), y, 0.01));
      }
      for (let i = 0; i < 5; i++) g.add(box(M2.dark, 0.02, 0.02, 0.006, w * 0.28, h / 2 - ((i + 1) * h) / 5 + 0.02, 0.01));
      g.userData.meta = { w, d: 0.05, h, collide: false, mount: true };
      return g;
    },
  },

  /* ------------------------- 软装 / 灯具 ------------------------- */
  rug: {
    name: '地毯', def: { w: 1.8, d: 1.3 }, h: 0.02,
    build(o) {
      const { w = 1.8, d = 1.3 } = o, M2 = m();
      const g = new THREE.Group();
      const r = slab(M2.rug, w, d, 0.02, 0, 0.01, 0, 0.16, 0.008);
      r.castShadow = false;
      g.add(r);
      const inner = slab(M2.fabricGreen, w - 0.26, d - 0.26, 0.022, 0, 0.011, 0, 0.14, 0.006);
      inner.castShadow = false;
      g.add(inner);
      g.userData.meta = { w, d, h: 0.02, collide: false };
      return g;
    },
  },

  play_mat: {
    name: '游戏爬行垫', def: { w: 1.8, d: 1.5 }, h: 0.03,
    build(o) {
      const { w = 1.8, d = 1.5 } = o, M2 = m();
      const g = new THREE.Group();
      const r = slab(M2.playMat, w, d, 0.035, 0, 0.017, 0, 0.4, 0.01);
      r.castShadow = false;
      g.add(r);
      const cols = [0xd9c9a8, 0xa8b39c, 0xc9a68a];
      for (let i = 0; i < 3; i++) {
        const c = slab(new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.95 }),
          w * 0.22, d * 0.22, 0.038, -w * 0.26 + i * w * 0.26, 0.019, 0, 0.2, 0.006);
        c.castShadow = false;
        g.add(c);
      }
      g.userData.meta = { w, d, h: 0.04, collide: false };
      return g;
    },
  },

  wall_art: {
    name: '挂画', def: { w: 0.9, h: 0.6, d: 0.04 }, h: 0.6,
    build(o) {
      const { w = 0.9, h = 0.6, mirror = false } = o, M2 = m();
      const g = new THREE.Group();
      g.add(box(M2.artFrame, w + 0.04, h + 0.04, 0.03, 0, 0, 0.015));
      if (mirror) {
        g.add(box(M2.mirror, w - 0.02, h - 0.02, 0.01, 0, 0, 0.032));
      } else {
        g.add(box(M2.artCanvas, w - 0.03, h - 0.03, 0.012, 0, 0, 0.03));
        // 抽象画面：几块低饱和色块
        const rnd = seeded(`art-${w}-${h}`);
        const cols = [0x7c8a76, 0xc9a87c, 0x51605a, 0xe0d6c2];
        for (let i = 0; i < 4; i++) {
          const cw = w * (0.18 + rnd() * 0.3), ch = h * (0.14 + rnd() * 0.34);
          g.add(box(new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.95 }),
            cw, ch, 0.004,
            (rnd() - 0.5) * (w - cw - 0.06), (rnd() - 0.5) * (h - ch - 0.06), 0.038));
        }
      }
      g.userData.meta = { w: w + 0.04, d: 0.06, h: h + 0.04, collide: false, mount: true };
      return g;
    },
  },

  floor_lamp: {
    name: '落地灯', def: { w: 0.36, h: 1.58 }, h: 1.58,
    build(o) {
      const { w = 0.36 } = o, M2 = m();
      const g = new THREE.Group();
      const H = 1.58;
      g.add(cyl(M2.metal, w / 2, w / 2 * 0.92, 0.022, 0, 0.011, 0, 24));
      g.add(cyl(M2.metal, 0.014, 0.016, H - 0.5, 0, (H - 0.5) / 2 + 0.02, 0, 12));
      const shadeMat = M2.lampShadeOff.clone();
      const shade = mesh(new THREE.CylinderGeometry(0.14, 0.185, 0.3, 26, 1, true), shadeMat, 0, H - 0.28, 0);
      tagLamp(shade, { color: 0xffd9a8, emissive: 1.0, intensity: 1.0 });
      g.add(shade);
      const bulb = mesh(new THREE.SphereGeometry(0.06, 14, 10), M2.bulbOff.clone(), 0, H - 0.3, 0);
      tagLamp(bulb, { color: 0xfff0d8, emissive: 1.6 });
      g.add(bulb);
      g.add(cyl(M2.metal, 0.155, 0.16, 0.012, 0, H - 0.13, 0, 26));
      g.userData.meta = { w, d: w, h: H, collide: true };
      return g;
    },
  },

  table_lamp: {
    name: '台灯', def: { w: 0.22, h: 0.42 }, h: 0.42,
    build(o) {
      const { w = 0.22 } = o, M2 = m();
      const g = new THREE.Group();
      const H = 0.42;
      g.add(cyl(M2.ceramic, w * 0.42, w * 0.52, 0.045, 0, 0.022, 0, 20));
      g.add(cyl(M2.stone, w * 0.22, w * 0.3, 0.13, 0, 0.11, 0, 18));
      g.add(cyl(M2.metal, 0.008, 0.008, 0.08, 0, 0.22, 0, 8));
      const shadeMat = M2.lampShadeOff.clone();
      const shade = mesh(new THREE.CylinderGeometry(0.075, 0.105, 0.15, 22, 1, true), shadeMat, 0, 0.3, 0);
      tagLamp(shade, { color: 0xffd9a8, emissive: 1.0 });
      g.add(shade);
      const bulb = mesh(new THREE.SphereGeometry(0.032, 12, 8), M2.bulbOff.clone(), 0, 0.29, 0);
      tagLamp(bulb, { color: 0xfff0d8, emissive: 1.7 });
      g.add(bulb);
      g.add(cyl(M2.metal, 0.08, 0.082, 0.008, 0, 0.377, 0, 22));
      g.userData.meta = { w: w * 1.1, d: w * 1.1, h: H, collide: false };
      return g;
    },
  },

  ceiling_lamp: {
    name: '吊灯', def: { w: 0.42, drop: 0.5 }, h: 0.6,
    build(o) {
      const { w = 0.42, drop = 0.5 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(cyl(M2.ceramic, 0.045, 0.055, 0.02, 0, -0.01, 0, 18));
      g.add(cyl(M2.metal, 0.006, 0.006, drop, 0, -drop / 2 - 0.02, 0, 8));
      const shadeMat = M2.lampShadeOff.clone();
      shadeMat.side = THREE.DoubleSide;
      const shade = mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.5, w * 0.62, 28, 1, true), shadeMat, 0, -drop - 0.2, 0);
      tagLamp(shade, { color: 0xffd9a8, emissive: 0.9 });
      g.add(shade);
      g.add(cyl(M2.metal, w * 0.5, w * 0.5, 0.008, 0, -drop - 0.2 + w * 0.31, 0, 28));
      const bulb = mesh(new THREE.SphereGeometry(w * 0.2, 14, 10), M2.bulbOff.clone(), 0, -drop - 0.22, 0);
      tagLamp(bulb, { color: 0xfff2dc, emissive: 1.8 });
      g.add(bulb);
      g.add(cyl(M2.ceramic, 0.02, 0.02, 0.03, 0, -drop - 0.22, 0, 10));
      g.userData.meta = { w, d: w, h: drop + w, collide: false, mount: true, ceiling: true };
      return g;
    },
  },

  nightlight: {
    name: '小夜灯', def: { w: 0.16, h: 0.14 }, h: 0.14,
    build(o) {
      const { w = 0.16 } = o, M2 = m();
      const g = new THREE.Group();
      g.add(cyl(M2.ceramic, w * 0.5, w * 0.56, 0.02, 0, 0.01, 0, 18));
      const dome = mesh(new THREE.SphereGeometry(w * 0.46, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), M2.bulbOff.clone(), 0, 0.02, 0);
      tagLamp(dome, { color: 0xffb877, emissive: 1.3, nightOnly: true });
      g.add(dome);
      g.userData.meta = { w, d: w, h: 0.16, collide: false };
      return g;
    },
  },

  plant: {
    name: '绿植', def: { h: 1.0 }, h: 1.0,
    build(o) {
      const H = o.h || 1.0, M2 = m();
      const g = new THREE.Group();
      const potR = Math.min(0.24, 0.1 + H * 0.1);
      g.add(mesh(new THREE.CylinderGeometry(potR, potR * 0.78, potR * 1.5, 20), M2.ceramic, 0, potR * 0.75, 0));
      g.add(mesh(new THREE.TorusGeometry(potR, 0.012, 6, 20), M2.ceramic, 0, potR * 1.5, 0, 0));
      g.add(mesh(new THREE.CylinderGeometry(potR * 0.9, potR * 0.9, 0.02, 18), M2.soil, 0, potR * 1.45, 0));
      const trunkH = H - potR * 1.5;
      if (trunkH > 0.2) g.add(cyl(M2.woodDark, 0.012, 0.018, trunkH * 0.7, 0, potR * 1.5 + trunkH * 0.35, 0, 8));
      const clusters = H < 0.7 ? 5 : 7;
      for (let i = 0; i < clusters; i++) {
        const a = (i / clusters) * Math.PI * 2 + i * 0.7;
        const rr = (H < 0.7 ? 0.1 : 0.16) * (0.5 + Math.random() * 0.6);
        const y = potR * 1.5 + trunkH * (0.45 + Math.random() * 0.55);
        for (let k = 0; k < 5; k++) {
          const leaf = mesh(new THREE.SphereGeometry(0.5, 7, 5), k % 2 ? M2.plantLeaf : M2.plantLeaf2,
            Math.sin(a + k * 0.7) * rr, y - k * 0.02, Math.cos(a + k * 0.7) * rr);
          leaf.scale.set(0.028, 0.055, 0.2);
          leaf.rotation.y = a + k * 0.7 + Math.PI / 2;
          leaf.rotation.z = (Math.random() - 0.5) * 1.4;
          g.add(leaf);
        }
      }
      g.userData.meta = { w: potR * 2, d: potR * 2, h: H, collide: true };
      return g;
    },
  },
};

/** 沙发族共用构建 */
function sofa(o, seats, bed = false) {
  const { w = 1.5, d = 0.92, h = 0.78 } = o, M2 = m();
  const g = new THREE.Group();
  g.add(box(M2.woodDark, w - 0.06, 0.1, d - 0.08, 0, 0.14, 0));
  // 底座用灰绿：在暖白墙面之前才有明确轮廓（否则奶油色坐垫全糊在墙上）
  g.add(slab(M2.fabricGreen, w - 0.02, d - 0.04, 0.22, 0, 0.32, 0.02, 0.07));
  const cw = (w - 0.3) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.15 + cw * (i + 0.5);
    g.add(slab(M2.fabricCream, cw - 0.03, d - 0.24, 0.13, x, 0.47, 0.07, 0.05));
    const bk = slab(M2.fabricCream, cw - 0.03, 0.14, 0.36, x, 0.6, -d / 2 + 0.15, 0.05);
    bk.rotation.x = 0.12;
    g.add(bk);
  }
  const useArms = !bed;
  if (useArms) {
    [-1, 1].forEach((s) => {
      g.add(slab(M2.fabricGreen, 0.14, d - 0.06, 0.3, s * (w / 2 - 0.07), 0.44, 0, 0.055));
      g.add(box(M2.woodDark, 0.06, 0.1, d - 0.14, s * (w / 2 - 0.07), 0.08, 0));
    });
  } else {
    [-1, 1].forEach((s) => g.add(box(M2.woodDark, 0.08, 0.2, d - 0.14, s * (w / 2 - 0.05), 0.08, 0)));
    g.add(box(M2.metal, w - 0.1, 0.014, 0.014, 0, 0.2, d / 2 - 0.08));
  }
  g.add(slab(M2.fabricLinen, w * 0.3, d * 0.5, 0.12, -w * 0.24, 0.56, 0.06, 0.06));
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
    g.add(leg(M2.woodDark, sx * (w / 2 - 0.1), sz * (d / 2 - 0.1), 0.1, 0.022, 1.5)));
  g.userData.meta = { w, d: bed ? d + 0.9 : d, h, collide: true, bed };
  return g;
}

/* ---------------------------- 工厂 ---------------------------- */
const GLR = new Set();

/** 建一件家具；返回 Group（原点在底面中心） */
export function createFurniture(type, item) {
  const def = CATALOG[type];
  if (!def) {
    const g = new THREE.Group();
    g.add(box(m().dark, 0.4, 0.4, 0.4, 0, 0.2, 0));
    g.userData.meta = { w: 0.4, d: 0.4, h: 0.4, collide: true };
    g.userData.unknownType = type;
    return g;
  }
  const opts = { ...(def.def || {}), ...(item.o || {}) };
  const g = def.build(opts);
  g.userData.meta = { ...(g.userData.meta || {}), type, assetName: def.name };
  g.userData.glb = GLR.has(type) ? type : null;
  g.name = `furniture:${type}`;
  return g;
}

export const registerGlb = (type) => GLR.add(type);
export const hasGlb = (type) => GLR.has(type);
export const FURNITURE_TYPES = Object.keys(CATALOG);
export const catalogHeight = (type, o = {}) => {
  const def = CATALOG[type];
  if (!def) return 0.4;
  return def.h;
};
