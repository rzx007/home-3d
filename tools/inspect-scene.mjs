/**
 * tools/inspect-scene.mjs —— 把场景里"可疑对象"列出来（位置/尺寸/材质/可见性）
 * 用法：node tools/inspect-scene.mjs [url] [minY] [filter]
 */
import { launch } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:8181/index.html?i=1';
const MINY = Number(process.argv[3] ?? 1.6);
const FILTER = process.argv[4] || '';

const cdp = await launch({ url: URL_, port: 9351, width: 1400, height: 900, waitMs: 6000 });
const { evaluate, sleep } = cdp;
await evaluate('window.__house.intro.skip()');
await sleep(2000);
await evaluate(`window.__house.ui.setMode('dollhouse', true); window.__house.ui.setLayout('work', true); window.__house.ui.applyTime(10.2,true);`);
await sleep(2000);

const q = `(() => {
  const h = window.__house, T = h.THREE, out = [];
  const box = new T.Box3();
  h.scene.updateMatrixWorld(true);
  h.scene.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    const cy = (box.min.y + box.max.y) / 2, sy = box.max.y - box.min.y;
    if (cy < ${MINY} && sy < 0.6) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const nm = o.name || '';
    const filter = ${JSON.stringify(FILTER)};
    if (filter && !(nm.includes(filter) || (m && m.name || '').includes(filter))) return;
    out.push({
      name: nm.slice(0, 60),
      parent: (o.parent && o.parent.name || '').slice(0, 40),
      y: [+box.min.y.toFixed(2), +box.max.y.toFixed(2)],
      x: [+box.min.x.toFixed(2), +box.max.x.toFixed(2)],
      z: [+box.min.z.toFixed(2), +box.max.z.toFixed(2)],
      mat: m ? (m.type + (m.transparent ? '/T' + (m.opacity ?? 1) : '') + (m.colorWrite === false ? '/noColor' : '') + (m.side === 2 ? '/dbl' : '')) : 'none',
      vis: o.visible, cw: m ? m.colorWrite : null, nClip: m && m.clippingPlanes ? m.clippingPlanes.length : 0,
      clipC: m && m.clippingPlanes && m.clippingPlanes[0] ? +m.clippingPlanes[0].constant.toFixed(2) : null,
      cast: o.castShadow,
    });
  });
  return JSON.stringify({
    total: out.length,
    items: out.slice(0, 60),
    ceilingVisible: h.shell.ceiling.visible,
    ceilingShadow: { vis: h.shell.ceilingShadow.visible, cw: h.shell.ceilingShadow.material.colorWrite, dw: h.shell.ceilingShadow.material.depthWrite },
    shadowType: h.renderer.shadowMap.type,
    sunCast: h.lighting.sun.castShadow,
    shadowRadius: h.lighting.sun.shadow.radius,
    blurSamples: h.lighting.sun.shadow.blurSamples,
    wallMats: h.views.wallMats.length,
    doorMatClip: (() => { const d = h.shell.doorObjs[0].userData.door; return d.materials.map(m => m.clippingPlanes ? m.clippingPlanes.length : 0); })(),
  }, null, 1);
})()`;

console.log(await evaluate(q));
cdp.close();
process.exit(0);
