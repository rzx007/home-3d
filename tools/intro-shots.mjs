/**
 * tools/intro-shots.mjs —— 开场动画过程截图（不跳过）
 * headless 是软件渲染，动画按墙钟时间推进，所以按真实秒数等待。
 * 用法：node tools/intro-shots.mjs [url]
 */
import path from 'node:path';
import { launch } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:8181/index.html?intro=1';
const RUN = `intro-${Date.now().toString(36).slice(-4)}`;
const DIR = path.resolve('shots', RUN);

const cdp = await launch({ url: URL_, port: 9371, width: 1600, height: 1000, waitMs: 3000 });
const { evaluate, screenshot, sleep } = cdp;

// 每 4 秒采一次，覆盖 0 → 40 秒（headless 下动画时间约为墙钟的 1/3）
const marks = [4, 8, 12, 16, 20, 26, 32, 40];
for (const t of marks) {
  const st = await evaluate(`JSON.stringify({
    p: +window.__house.intro.progress.toFixed(3),
    done: window.__house.intro.finished,
    t: +(window.__house.intro.progress * 6.7).toFixed(2),
    frames: window.__house.frames,
    mode: window.__house.views.mode,
    camY: +window.__house.views.camera.position.y.toFixed(1),
    step: document.getElementById('intro-step').textContent,
    hud: document.getElementById('hud').className || '(hidden)'
  })`);
  await screenshot(path.join(DIR, `t${String(t).padStart(2, '0')}.png`));
  console.log(`  +${String(t).padStart(2)}s  ${st}`);
  await sleep(4000);
}

console.log('\n异常：', cdp.exceptions.length);
for (const e of cdp.exceptions.slice(0, 5)) console.log(`  ✗ ${e.text} :: ${e.desc} @ ${e.where}`);
console.log('console.error：', cdp.logs.filter((l) => l.level === 'error').length);
console.log(`截图目录：${DIR}`);
cdp.close();
process.exit(0);
