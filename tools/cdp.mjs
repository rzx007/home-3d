/**
 * tools/cdp.mjs —— 极简 CDP 客户端（Node 22+ 自带 WebSocket，无第三方依赖）
 * 供 headless-check.mjs / shots.mjs 复用。
 */
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_CHROME = process.env.CHROME
  || 'C:\\Users\\ruanz\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

export async function launch({
  url, chrome = DEFAULT_CHROME, port = 9333, width = 1600, height = 1000, waitMs = 7000,
} = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const close = () => {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ignore */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* not up */ }
    if (!wsUrl) await sleep(150);
  }
  if (!wsUrl) { close(); throw new Error('CDP 端口未就绪'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const exceptions = [];
  const logs = [];

  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push({
        text: d.text,
        desc: d.exception && (d.exception.description || d.exception.value),
        where: `${String(d.url || '').replace(/^.*\//, '')}:${d.lineNumber}:${d.columnNumber}`,
        stack: (d.stackTrace && d.stackTrace.callFrames ? d.stackTrace.callFrames : [])
          .slice(0, 5).map((f) => `      at ${f.functionName || '<fn>'} (${String(f.url).replace(/^.*\//, '')}:${f.lineNumber})`).join('\n'),
      });
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push({
        level: m.params.type,
        text: (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '),
      });
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      logs.push({ level: e.level, text: `${e.text} ${e.url || ''}` });
    }
  });

  const send = (method, params = {}) => new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      exceptions.push({ text: 'evaluate 抛错', desc: r.result.exceptionDetails.text, where: expression.slice(0, 90), stack: '' });
      return undefined;
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const screenshot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    if (!r.result || !r.result.data) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return true;
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  if (waitMs) await sleep(waitMs);

  return { send, evaluate, screenshot, exceptions, logs, close, ws, sleep };
}
