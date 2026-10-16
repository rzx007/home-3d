/**
 * tools/shots.mjs —— 抓一组验收截图（四种视角 × 三种方案 × 三个时段）
 *
 * 用法：node tools/shots.mjs [url] [outDir]
 */
import path from 'node:path';
import fs from 'node:fs';
import { launch } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:8181/index.html?shot=1';
const OUT = process.argv[3] || path.resolve('shots');
// 每次跑用独立子目录，避免看到上一次的旧图
const RUN = `r${Date.now().toString(36).slice(-4)}`;
const DIR = path.join(OUT, RUN);
const PORT = 9341;

const cdp = await launch({ url: URL_, port: PORT, width: 1600, height: 1000, waitMs: 6500 });
const { evaluate, screenshot, sleep } = cdp;

// 跳过开场动画（headless 是软件渲染，帧率极低）
console.log('skip intro:', await evaluate('window.__house && (window.__house.intro.skip(), "ok")'));
await sleep(2500);

const hideHud = process.argv.includes('--nohud');
if (hideHud) await evaluate(`document.getElementById('hud').style.display='none'`);

const shots = [];
// 注意：headless 是软件渲染（约 3fps），相机过渡按墙钟时间走，所以要等足够久
const at = (name, expr, wait = 5200) => shots.push([name, expr, wait]);

at('01-dollhouse-work-morning', `
  window.__house.ui.setLayout('work', true);
  window.__house.ui.setMode('dollhouse', true);
  window.__house.ui.applyTime(10.2, true);
`);
at('02-dollhouse-work-evening', `window.__house.ui.applyTime(18.4, true);`);
at('03-dollhouse-work-night', `
  window.__house.ui.applyTime(21.2, true);
  window.__house.views.setMode('dollhouse');
`);
at('04-top-work', `window.__house.ui.setMode('top', true);`);
at('05-section-work', `window.__house.ui.setMode('section', true);`);
at('06-walk-work', `window.__house.ui.setMode('walk', true);`);
at('07-dollhouse-guest-day', `
  window.__house.ui.setMode('dollhouse', true);
  window.__house.ui.setLayout('guest', true);
  window.__house.ui.applyTime(13.5, true);
`);
at('08-dollhouse-future-day', `window.__house.ui.setLayout('future', true);`);
at('09-roomB-work', `
  window.__house.ui.setLayout('work', true);
  window.__house.ui.applyTime(10.2, true);
`);
at('10-cards', `
  window.__house.ui.setRoom('roomB', true);
  window.__house.ui.setMode('dollhouse', true);
`);

console.log(`输出目录：${DIR}`);
const SETTLE = `(() => {
  const v = window.__house.views;
  v.state.flyT = 999;                      // 相机过渡直接落到终点
  v.state.section = v.state.sectionGoal;    // 剖切动画直接到位
  v.state.cut = v.state.cutGoal;
  v.cOrbit.enabled = v.mode !== 'top';
  v.cTop.enabled = v.mode === 'top';
  return 'settled';
})()`;
for (const [name, expr, wait] of shots) {
  await evaluate(expr);
  await sleep(900);
  await evaluate(SETTLE);
  await sleep(wait);
  const ok = await screenshot(path.join(DIR, `${name}.png`));
  const status = await evaluate(`JSON.stringify({
    mode: window.__house.views.mode,
    layout: window.__house.ui.layout,
    clock: document.getElementById('time-clock').textContent,
    calls: window.__house.renderer.info.render.calls,
    tris: window.__house.renderer.info.render.triangles,
    frames: window.__house.frames,
    camY: +window.__house.views.camera.position.y.toFixed(2)
  })`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}.png  ${status}`);
}

console.log('\n异常：', cdp.exceptions.length);
for (const e of cdp.exceptions.slice(0, 8)) console.log(`  ✗ ${e.text} :: ${e.desc} @ ${e.where}`);
const errs = cdp.logs.filter((l) => l.level === 'error');
console.log('console.error：', errs.length);
for (const e of errs.slice(0, 8)) console.log(`  ${e.text}`);

cdp.close();
process.exit(0);
