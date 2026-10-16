/**
 * optimize.js —— 把"静态 mesh"按材质合并，压低 draw call
 *
 * 这套模型全部是刚体：墙、窗框、家具摆放好之后都不再逐 mesh 变形，
 * 所以可以把同一个"合并单元"里共用材质的 mesh 烘焙成世界相对矩阵后合并成
 * 一个几何体。实测能把 draw call 从 2000+ 降到 400 量级。
 *
 * 需要保持独立的对象用 userData.mergeUnit = true 标记（例如随开场动画弹出的
 * 窗套、会转动的门扇），它们自己作为单元合并，不与父级混在一起。
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();

/**
 * @param {THREE.Object3D} root 合并单元根节点
 * @returns {{before:number, after:number}} 合并前后的 mesh 数量
 */
export function mergeStatic(root) {
  const units = [];
  (function collect(node) {
    if (node.userData && node.userData.mergeUnit) { units.push(node); return; }
    for (const c of node.children) collect(c);
  })(root);
  units.unshift(root);

  let before = 0, after = 0;

  for (const unit of units) {
    // 收集本单元内的 mesh（跳过子单元）
    const meshes = [];
    (function gather(node, isRoot) {
      for (const c of node.children) {
        if (!isRoot && c.userData && c.userData.mergeUnit) continue;
        if (c.isMesh) {
          if (c.userData && c.userData.noMerge) continue;
          if (Array.isArray(c.material)) continue;
          if (!c.geometry || !c.geometry.attributes || !c.geometry.attributes.position) continue;
          if (!c.geometry.attributes.normal || !c.geometry.attributes.uv) continue;
          meshes.push(c);
        } else gather(c, false);
      }
    })(unit, true);

    if (meshes.length < 2) continue;
    before += meshes.length;

    // 相对单元根节点烘焙矩阵
    unit.updateWorldMatrix(true, false);
    const invRoot = unit.matrixWorld.clone().invert();

    const buckets = new Map();
    for (const mesh of meshes) {
      const key = mesh.material;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(mesh);
    }

    unit.updateWorldMatrix(true, true);
    for (const [material, list] of buckets) {
      const geos = [];
      for (const mesh of list) {
        mesh.updateWorldMatrix(true, false);
        _m.copy(invRoot).multiply(mesh.matrixWorld);
        // 法线要跟着非均匀缩放走
        _nm.getNormalMatrix(_m);
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        g.applyMatrix4(_m);
        // 清理可能存在的多余属性，保证属性集一致
        for (const name of Object.keys(g.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        }
        geos.push(g);
      }
      let merged;
      try {
        merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      } catch (e) {
        merged = null;
      }
      if (!merged) { for (const g of geos) g.dispose(); continue; }
      merged.computeBoundingSphere();

      const first = list[0];
      const out = new THREE.Mesh(merged, material);
      out.castShadow = list.some((x) => x.castShadow) && !isTranslucent(material);
      out.receiveShadow = list.some((x) => x.receiveShadow);
      out.renderOrder = first.renderOrder || 0;
      out.frustumCulled = true;
      out.userData = { ...first.userData };
      if (Array.isArray(out.userData.mergeUnit)) delete out.userData.mergeUnit;
      out.name = `${unit.name || 'unit'}:merged(${list.length})`;
      unit.add(out);
      after++;
      for (const mesh of list) {
        unit.remove(mesh);
        if (mesh.geometry && mesh.geometry !== merged) mesh.geometry.dispose();
      }
    }
  }

  return { before, after };
}

const isTranslucent = (mat) => !!(mat && mat.transparent && (mat.opacity ?? 1) < 0.6);

/** 递归统计 mesh 数量（性能对比用） */
export function countMeshes(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh) n++; });
  return n;
}
