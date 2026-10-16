/**
 * tools/headless-check.mjs —— 用 CDP 驱动真实 Chrome 做冒烟测试
 *
 * 起因：`--dump-dom --virtual-time-budget` 遇到持续 rAF 的页面会挂住，
 * 所以这里改成"启动 headless Chrome + 连 CDP + 采集异常 + 主动跑一遍交互"。
 *
 * 用法：node tools/headless-check.mjs [url] [waitMs]
 * 退出码：0 = 无异常，1 = 有异常
 */
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME = process.env.CHROME
  || 'C:\\Users\\ruanz\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = process.argv[2] || 'http://127.0.0.1:8181/index.html';
const WAIT = Number(process.argv[3] || 9000);
const PORT = 9333 + (Number(process.env.CDP_OFFSET) || 0);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));

const args = [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars',
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
];

const child = spawn(CHROME, args, { stdio: 'ignore', detached: false });
const cleanup = () => {
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('CDP endpoint not reachable');
}

const wsUrl = await getTarget();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let msgId = 0;
const pending = new Map();
const exceptions = [];
const consoleMsgs = [];

ws.addEventListener('message', (ev) => {
  let m;
  try { m = JSON.parse(ev.data); } catch { return; }
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push({
      text: d.text,
      desc: d.exception && (d.exception.description || d.exception.value),
      where: `${(d.url || '').replace(/^.*\//, '')}:${d.lineNumber}:${d.columnNumber}`,
      stack: d.stackTrace && d.stackTrace.callFrames
        ? d.stackTrace.callFrames.slice(0, 4).map((f) => `      at ${f.functionName || '<fn>'} (${f.url.replace(/^.*\//, '')}:${f.lineNumber})`).join('\n')
        : '',
    });
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    consoleMsgs.push(`${m.params.type}: ${txt}`);
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' || e.level === 'warning') consoleMsgs.push(`log.${e.level}: ${e.text} ${e.url || ''}`);
  }
});

const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    exceptions.push({ text: 'evaluate threw', desc: r.result.exceptionDetails.text, where: 'evaluate', stack: '' });
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(WAIT);

const STATUS = `(() => {
  const q = (s) => document.querySelector(s);
  const h = window.__house;
  const info = h && h.renderer.info;
  return JSON.stringify({
    err: document.documentElement.getAttribute('data-error'),
    bootError: !!q('#boot .err') ? q('#boot .err').textContent.slice(0,400) : null,
    bootClass: (q('#boot')||{}).className, hudClass: (q('#hud')||{}).className,
    introClass: (q('#intro')||{}).className,
    introStep: (q('#intro-step')||{}).textContent,
    clock: (q('#time-clock')||{}).textContent, phase: (q('#time-phase')||{}).textContent,
    roomListCount: document.querySelectorAll('#room-items li').length,
    cardTitle: (q('#card-body h3')||{}).textContent,
    cardFurn: document.querySelectorAll('#card-body .furn li').length,
    cardFigures: [...document.querySelectorAll('#card-figures, .card-figures dd')].map(d=>d.textContent.trim()).slice(0,6),
    assetStatus: (q('#asset-status')||{}).textContent,
    miniTag: (q('#minimap-tag')||{}).textContent,
    modalOn: [...document.querySelectorAll('#layout-switch button')].map(b=>b.dataset.id+(b.classList.contains('on')?'*':'')),
    viewOn: [...document.querySelectorAll('#view-switch button')].map(b=>b.dataset.id+(b.classList.contains('on')?'*':'')),
    frames: h ? h.frames : -1,
    drawCalls: info ? info.render.calls : -1,
    triangles: info ? info.render.triangles : -1,
    programs: info && info.programs ? info.programs.length : -1,
    lights: h ? h.lighting.lamps.length : -1,
    sunIntensity: h ? +h.lighting.sun.intensity.toFixed(2) : -1,
    lampFactor: h ? +h.lighting.lampFactor.toFixed(2) : -1,
    clipConst: h ? +h.views.sectionPlane.constant.toFixed(2) : -1,
    dollConst: h ? +h.views.dollPlane.constant.toFixed(2) : -1,
    mode: h ? h.views.mode : '?',
    camPos: h ? [h.views.camera.position.x, h.views.camera.position.y, h.views.camera.position.z].map(v=>+v.toFixed(2)) : null,
    camFov: h ? h.views.camera.fov : -1,
    furnitureGroups: h ? h.furniture.length : -1,
    sceneChildren: h ? h.scene.children.length : -1,
    activeLayout: h ? h.ui.layout : '?',
    glbCount: h ? h.glb().count : -1,
    glbTried: h ? h.glb().tried : -1,
    webgl: (() => { try { const c=document.createElement('canvas'); return !!(c.getContext('webgl2')||c.getContext('webgl')); } catch(e){ return false; } })(),
    renderer: h ? h.renderer.getContext().getParameter(h.renderer.getContext().VERSION) : null,
  });
})()`;

console.log('=== 载入后状态 ===');
console.log(await evaluate(STATUS));

/* ------------------- 交互冒烟：4 视角 × 3 方案 × 3 时段 ------------------- */
const steps = [];
const modes = ['dollhouse', 'top', 'section', 'walk'];
const layouts = ['work', 'guest', 'future'];
const times = [7, 12.5, 21];

for (const l of layouts) steps.push([`layout:${l}`, `window.__house.ui.setLayout('${l}', true)`]);
for (const m of modes) steps.push([`view:${m}`, `window.__house.ui.setMode('${m}', true)`]);
for (const t of times) steps.push([`time:${t}`, `window.__house.ui.applyTime(${t}, true)`]);
steps.push(['room:living', `window.__house.ui.setRoom('living', true)`]);
steps.push(['room:roomB', `window.__house.ui.setRoom('roomB', true)`]);
steps.push(['room:bath', `window.__house.ui.setRoom('bath', true)`]);
steps.push(['door:toggle', `window.__house.views.toggleNearestDoor()`]);
steps.push(['rebuild:future', `window.__house.rebuild('future')`]);
steps.push(['pick-center', `window.__house.views.toggleDoor('d-entry')`]);
steps.push(['glb-swap-on', `document.getElementById('opt-glb').checked=true; window.__house.ui.setLayout('guest', true)`]);

console.log('\n=== 交互冒烟 ===');
for (const [name, expr] of steps) {
  const before = exceptions.length;
  await evaluate(expr);
  await sleep(420);
  const errs = exceptions.length - before;
  console.log(`  ${errs ? 'FAIL' : 'ok  '} ${name}${errs ? ` (+${errs} exception)` : ''}`);
}

await sleep(1200);
console.log('\n=== 交互后状态 ===');
console.log(await evaluate(STATUS));

console.log('\n=== 未捕获异常 ===');
if (!exceptions.length) console.log('  无');
else for (const e of exceptions) console.log(`  ✗ ${e.text} :: ${e.desc}\n    ${e.where}\n${e.stack}`);

const noisy = consoleMsgs.filter((m) => !/Download the React|three\.js|DevTools/.test(m));
console.log('\n=== console 输出（前 40 条）===');
if (!noisy.length) console.log('  无');
else for (const m of noisy.slice(0, 40)) console.log(`  ${m}`);

console.log(`\n结论：${exceptions.length ? 'FAIL' : 'PASS'}（异常 ${exceptions.length} 条）`);
ws.close();
cleanup();
process.exit(exceptions.length ? 1 : 0);
