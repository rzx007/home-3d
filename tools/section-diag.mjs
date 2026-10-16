/**
 * tools/section-diag.mjs —— 定位"1.35m 剖切"视角的取景/背景问题
 */
import { launch } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:8181/index.html?d=1';
const cdp = await launch({ url: URL_, port: 9361, width: 1600, height: 1000, waitMs: 6000 });
const { evaluate, sleep, screenshot } = cdp;
await evaluate('window.__house.intro.skip()');
await sleep(1500);
await evaluate(`window.__house.ui.setMode('section', true);`);
await sleep(1200);
await evaluate(`window.__house.views.state.flyT = 999;`);
await sleep(2500);

const q = `(() => {
  const h = window.__house, T = h.THREE;
  const cam = h.views.camera;
  const persp = h.views.persp;
  const proj = (x,y,z) => { const v = new T.Vector3(x,y,z).project(cam); return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]; };
  const pt = (x,y,z) => { const v = new T.Vector3(x,y,z).applyMatrix4(cam.projectionMatrixInverse).applyMatrix4(cam.matrixWorld); return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]; };
  return JSON.stringify({
    version: h.version,
    mode: h.views.mode,
    isPersp: cam === persp,
    fov: cam.fov, near: cam.near, far: cam.far, aspect: +cam.aspect.toFixed(3),
    pos: [cam.position.x, cam.position.y, cam.position.z].map(v=>+v.toFixed(2)),
    rotDeg: [cam.rotation.x, cam.rotation.y, cam.rotation.z].map(v=>+(v*180/Math.PI).toFixed(1)),
    quat: cam.quaternion.toArray().map(v=>+v.toFixed(3)),
    fwd: (() => { const d = new T.Vector3(0,0,-1).applyQuaternion(cam.quaternion); return [d.x,d.y,d.z].map(v=>+v.toFixed(3)); })(),
    // 期望朝向：从 pos 指向 (4.8,1.2,3.6)
    wantFwd: (() => { const d = new T.Vector3(4.8,1.2,3.6).sub(cam.position).normalize(); return [d.x,d.y,d.z].map(v=>+v.toFixed(3)); })(),
    ndcCenter: proj(4.8, 1.2, 3.6),
    ndcCorners: [proj(0,1.35,0), proj(9.6,1.35,0), proj(0,1.35,7.2), proj(9.6,1.35,7.2)],
    bg: h.scene.background ? '#'+h.scene.background.getHexString() : null,
    fog: { color: '#'+h.scene.fog.color.getHexString(), density: h.scene.fog.density },
    skyVisible: h.lighting.sky.visible,
    fillIntensity: h.lighting.fill.intensity,
    hemi: +h.lighting.hemi.intensity.toFixed(2),
    amb: +h.lighting.amb.intensity.toFixed(2),
    sunInt: +h.lighting.sun.intensity.toFixed(2),
    clipConst: +h.views.sectionPlane.constant.toFixed(2),
    groundVisible: (() => { let v=null; h.shell.root.traverse(o=>{ if(o.userData && o.userData.isPlinth && v===null) v=o.visible; }); return v; })(),
    orbitTarget: h.views.cOrbit.target.toArray().map(v=>+v.toFixed(2)),
    orbitEnabled: h.views.cOrbit.enabled,
  }, null, 1);
})()`;

console.log(await evaluate(q));
await screenshot('shots/_diag-section.png');
console.log('screenshot -> shots/_diag-section.png');
cdp.close();
process.exit(0);
