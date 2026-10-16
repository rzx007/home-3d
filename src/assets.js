/**
 * assets.js —— Blender 预制 GLB 资产的接入层
 *
 * 本页所有家具都是程序化建模（可直接跑，零外部资源）。
 * 同时预留一条"高质量资产"通道：如果 assets/glb/<name>.glb 存在（由
 * blender/build_assets.py 批量导出），运行时会自动用它替换同名程序化家具，
 * 并把原点归一到"底面中心"，所以无论 GLB 建模时原点在哪都能正确落地。
 *
 * ASSET_MANIFEST 里的 32 件就是那套低面数 GLB 资产清单，尺寸与程序化版本一致，
 * 因此替换后碰撞盒仍然有效。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** 32 件预制资产：file 名与 blender/build_assets.py 输出的文件名一一对应 */
export const ASSET_MANIFEST = [
  { name: 'bed_double', cn: '双人床 1.5m', size: [1.50, 1.05, 2.00] },
  { name: 'bed_single', cn: '单人床 1.2m', size: [1.20, 1.00, 1.95] },
  { name: 'crib', cn: '婴儿床', size: [1.20, 0.92, 0.66] },
  { name: 'nightstand', cn: '床头柜', size: [0.45, 0.50, 0.40] },
  { name: 'wardrobe', cn: '衣柜', size: [2.00, 2.20, 0.60] },
  { name: 'desk', cn: '升降书桌', size: [1.40, 0.75, 0.70] },
  { name: 'desk_chair', cn: '人体工学椅', size: [0.68, 1.05, 0.68] },
  { name: 'bookshelf', cn: '书架', size: [1.00, 1.80, 0.32] },
  { name: 'filing_cabinet', cn: '文件柜', size: [0.42, 0.62, 0.50] },
  { name: 'armchair', cn: '单人沙发', size: [0.78, 0.76, 0.82] },
  { name: 'sofa_3seat', cn: '三人沙发', size: [2.10, 0.78, 0.92] },
  { name: 'sofa_2seat', cn: '双人沙发', size: [1.50, 0.78, 0.92] },
  { name: 'sofa_bed', cn: '沙发床', size: [1.50, 0.78, 0.95] },
  { name: 'coffee_table', cn: '茶几', size: [1.10, 0.40, 0.55] },
  { name: 'side_table', cn: '边几', size: [0.45, 0.52, 0.45] },
  { name: 'tv_console', cn: '电视柜', size: [1.80, 0.45, 0.42] },
  { name: 'dining_table', cn: '餐桌 1.4m', size: [1.40, 0.75, 0.80] },
  { name: 'dining_chair', cn: '餐椅', size: [0.46, 0.87, 0.50] },
  { name: 'sideboard', cn: '餐边柜', size: [1.20, 0.80, 0.42] },
  { name: 'shoe_cabinet', cn: '鞋柜', size: [1.20, 1.10, 0.35] },
  { name: 'bench', cn: '换鞋凳', size: [0.90, 0.42, 0.38] },
  { name: 'coat_rack', cn: '衣帽架', size: [0.35, 1.77, 0.35] },
  { name: 'kitchen_counter', cn: '橱柜地柜', size: [1.30, 0.86, 0.60] },
  { name: 'sink', cn: '水槽 + 龙头', size: [0.62, 0.28, 0.44] },
  { name: 'stove', cn: '燃气灶', size: [0.60, 0.06, 0.50] },
  { name: 'range_hood', cn: '油烟机', size: [0.60, 0.62, 0.52] },
  { name: 'fridge', cn: '冰箱', size: [0.60, 1.85, 0.65] },
  { name: 'toilet', cn: '马桶', size: [0.68, 0.80, 0.70] },
  { name: 'vanity', cn: '浴室柜', size: [0.80, 0.85, 0.45] },
  { name: 'shower', cn: '淋浴房', size: [0.90, 2.00, 0.90] },
  { name: 'washer', cn: '洗衣机', size: [0.60, 0.86, 0.62] },
  { name: 'plant', cn: '绿植', size: [0.32, 1.00, 0.32] },
];

export const MANIFEST_BY_NAME = Object.fromEntries(ASSET_MANIFEST.map((a) => [a.name, a]));

/**
 * 尝试加载 GLB 资产。任何一件不存在都不影响运行（继续用程序化版本）。
 * @returns {Promise<{loaded:Object<string,THREE.Object3D>, count:number, tried:number}>}
 */
export async function loadGlbAssets({ base = 'assets/glb/', onProgress, only = null } = {}) {
  const loader = new GLTFLoader();
  const list = only ? ASSET_MANIFEST.filter((a) => only.includes(a.name)) : ASSET_MANIFEST;
  const loaded = {};
  let done = 0;

  // 先读 manifest.json（Blender 脚本生成 GLB 时会一并写入）。
  // 没生成时直接跳过，避免 32 个 404 扰动控制台。
  if (list.length) {
    let present = false;
    try {
      const r = await fetch(`${base}manifest.json`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        present = !!j && j.present === true && Array.isArray(j.generated) && j.generated.length > 0;
      }
    } catch (e) { present = false; }
    if (!present) {
      if (onProgress) onProgress(list.length, list.length, list[0].name);
      return { loaded, count: 0, tried: list.length, present: false };
    }
  }

  const one = async (asset) => {
    const url = `${base}${asset.name}.glb`;
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;
      normalizeOrigin(root, asset);
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            o.material.side = o.material.side ?? THREE.FrontSide;
            o.material.shadowSide = THREE.FrontSide;
          }
        }
      });
      loaded[asset.name] = root;
    } catch (e) {
      // 静默跳过：assets/glb 未生成时保持程序化建模
    } finally {
      done++;
      if (onProgress) onProgress(done, list.length, asset.name);
    }
  };

  // 限流并发，避免一次性打满请求
  const queue = [...list];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await one(queue.shift());
  });
  await Promise.all(workers);
  return { loaded, count: Object.keys(loaded).length, tried: list.length, present: true };
}

/** 把任意来源的 GLB 归一到：底面贴地(y=0)、XZ 居中、单位米 */
export function normalizeOrigin(root, asset) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  // 若建模单位明显不对（比如用厘米导出的），按高度自动校正
  if (asset && asset.size && size.y > 0.001) {
    const want = asset.size[1];
    const k = want / size.y;
    if (k < 0.25 || k > 4) {
      root.scale.multiplyScalar(k);
      root.updateMatrixWorld(true);
    }
  }
  return root;
}

/**
 * 用已加载的 GLB 替换场景里对应的程序化家具。
 * @returns {{swapped:number, missing:string[]}}
 */
export function applyGlbSwap(root, loaded) {
  const missing = [];
  let swapped = 0;
  root.traverse((o) => {
    const t = o.userData && o.userData.glb;
    if (!t) return;
    const src = loaded[t];
    if (!src) { missing.push(t); return; }
    const clone = src.clone(true);
    clone.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    // 清空程序化子对象，换成 GLB
    for (let i = o.children.length - 1; i >= 0; i--) o.remove(o.children[i]);
    o.add(clone);
    o.userData.usingGlb = true;
    swapped++;
  });
  return { swapped, missing };
}

/** 生成一份给 Blender 用的尺寸表（便于脚本与前端保持一致） */
export function manifestAsBlenderDict() {
  const lines = ASSET_MANIFEST.map(
    (a) => `    "${a.name}": {"cn": "${a.cn}", "size": (${a.size[0]}, ${a.size[1]}, ${a.size[2]})},`,
  );
  return `ASSET_SPEC = {\n${lines.join('\n')}\n}`;
}
