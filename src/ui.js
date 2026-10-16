/**
 * ui.js —— HUD 交互层（纯 DOM，不碰 three）
 *
 * 负责：方案切换、视角切换、时间滑杆、房间清单与房间卡片、迷你地图、
 * 开场动画遮罩、启动遮罩与错误显示。
 * 所有业务数据都来自 plan.js，UI 只做渲染与事件转发。
 */
import { ROOMS, MODES, MODE_BY_ID, FURNITURE_NAMES, roomCard, ROOM_BY_ID } from './plan.js';
import { MODE_INFO, MODE_ORDER } from './views.js';
import { drawPlan } from './twod.js';

const $ = (id) => document.getElementById(id);

const TIME_PRESETS = [
  { h: 7.0, label: '07:00 清晨' },
  { h: 10.0, label: '10:00 上午' },
  { h: 12.5, label: '12:30 正午' },
  { h: 15.5, label: '15:30 下午' },
  { h: 18.0, label: '18:00 黄昏' },
  { h: 21.0, label: '21:00 夜晚' },
];

export function fmtClock(h) {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.round((((h % 1) + 1) % 1) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function phaseOf(h) {
  const t = ((h % 24) + 24) % 24;
  if (t < 5) return '深夜';
  if (t < 7) return '清晨';
  if (t < 11) return '上午';
  if (t < 13.5) return '正午';
  if (t < 16.5) return '下午';
  if (t < 18.5) return '黄昏';
  if (t < 22) return '夜晚';
  return '深夜';
}

export function createUI(handlers = {}) {
  const app = $('app');
  const hud = $('hud');
  const intro = $('intro');
  const boot = $('boot');
  const slider = $('time-slider');

  let mode = 'dollhouse';
  let layout = 'work';
  let selected = null;
  let labelsOn = true;
  let glbOn = false;

  /* ------------------------------ 方案切换 ------------------------------ */
  const layoutWrap = $('layout-switch');
  layoutWrap.innerHTML = MODES.map((m) => `
    <button type="button" data-id="${m.id}" title="${m.tag}">
      ${m.name}<span class="sub">${m.room.length}件</span>
    </button>`).join('');
  layoutWrap.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setLayout(b.dataset.id, true);
  });

  /* ------------------------------ 视角切换 ------------------------------ */
  const viewWrap = $('view-switch');
  viewWrap.innerHTML = MODE_ORDER.map((k) => {
    const key = k.toUpperCase();
    return `<button type="button" data-id="${k}" title="${MODE_INFO[k].hint}">
      ${MODE_INFO[k].label}<span class="sub">${key[0]}</span>
    </button>`;
  }).join('');
  viewWrap.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setMode(b.dataset.id, true);
  });

  /* ------------------------------ 房间清单 ------------------------------ */
  const list = $('room-items');
  list.innerHTML = ROOMS.map((r) => `
    <li data-id="${r.id}" class="${r.floor}${r.id === 'roomB' ? ' key' : ''}">
      <span class="bar"></span>
      <span class="nm">${r.name}${r.id === 'roomB' ? '<small>随方案变化</small>' : ''}</span>
      <span class="ar">${r.area.toFixed(2)}</span>
    </li>`).join('');
  $('area-net').textContent = `套内 ${ROOMS.reduce((s, r) => s + r.area, 0).toFixed(2)} ㎡`;
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    setRoom(li.dataset.id, true);
  });

  /* ------------------------------ 时间滑杆 ------------------------------ */
  slider.addEventListener('input', () => {
    const h = Number(slider.value) / 60;
    applyTime(h, true);
  });

  const presetWrap = $('time-presets');
  presetWrap.innerHTML = TIME_PRESETS.map((p) => `<button type="button" data-h="${p.h}">${p.label}</button>`).join('');
  presetWrap.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    applyTime(Number(b.dataset.h), true);
  });

  /* ------------------------------ 复选开关 ------------------------------ */
  $('opt-labels').addEventListener('change', (e) => {
    labelsOn = e.target.checked;
    if (handlers.onToggle) handlers.onToggle('labels', labelsOn);
  });
  $('opt-lamp-shadow').addEventListener('change', (e) => {
    if (handlers.onToggle) handlers.onToggle('lampShadow', e.target.checked);
  });
  $('opt-glb').addEventListener('change', (e) => {
    glbOn = e.target.checked;
    if (handlers.onToggle) handlers.onToggle('glb', glbOn);
  });

  /* ------------------------------ 迷你地图 ------------------------------ */
  const miniCanvas = $('minimap');
  const miniCtx = miniCanvas.getContext('2d');
  const miniBase = document.createElement('canvas');
  miniBase.width = miniCanvas.width;
  miniBase.height = miniCanvas.height;
  const miniBaseCtx = miniBase.getContext('2d');
  let miniDirty = true;
  let furnitureOutlines = [];

  function paintBase(modeLabel) {
    drawPlan(miniBaseCtx, {
      W: miniBase.width, H: miniBase.height, pad: 10, mini: true,
      furniture: furnitureOutlines, highlight: selected, mode: modeLabel, camera: null,
    });
    miniDirty = false;
  }

  function drawMini(view, roomName) {
    if (miniDirty) paintBase(MODE_INFO[mode]?.label || '');
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    miniCtx.drawImage(miniBase, 0, 0);
    if (view && mode === 'walk') {
      // 相机箭头
      const { s, ox, oy } = miniTransform();
      const x = ox + view.player.x * s, z = oy + view.player.z * s;
      miniCtx.save();
      miniCtx.translate(x, z);
      miniCtx.rotate(-view.player.yaw + Math.PI);
      miniCtx.fillStyle = '#5c6957';
      miniCtx.strokeStyle = '#fffdf8';
      miniCtx.lineWidth = 1.4;
      miniCtx.beginPath();
      miniCtx.moveTo(0, -8); miniCtx.lineTo(5, 6); miniCtx.lineTo(0, 3); miniCtx.lineTo(-5, 6);
      miniCtx.closePath(); miniCtx.fill(); miniCtx.stroke();
      miniCtx.restore();
    }
    if (roomName) {
      miniCtx.font = '600 12px system-ui, sans-serif';
      miniCtx.fillStyle = '#5c6957';
      miniCtx.textAlign = 'left';
      miniCtx.fillText(roomName, 10, miniCanvas.height - 10);
    }
  }

  function miniTransform() {
    const s = Math.min((miniCanvas.width - 20) / 9.6, (miniCanvas.height - 20) / 7.2);
    return { s, ox: (miniCanvas.width - 9.6 * s) / 2, oy: (miniCanvas.height - 7.2 * s) / 2 };
  }

  /* ------------------------------ 房间卡片 ------------------------------ */
  function renderCard(roomId, modeId) {
    const body = $('card-body');
    const empty = $('card-empty');
    if (!roomId) {
      body.hidden = true;
      empty.hidden = false;
      return;
    }
    const info = roomCard(roomId, modeId);
    const r = info.room;
    empty.hidden = true;
    body.hidden = false;

    // 家具按类型合并计数
    const grouped = new Map();
    for (const f of info.items) {
      const g = grouped.get(f.t) || { t: f.t, qty: 0, added: false, lamp: false, key: false };
      g.qty++;
      g.added = g.added || !!f.added;
      g.lamp = g.lamp || !!f.light;
      g.key = g.key || !!f.key;
      grouped.set(f.t, g);
    }
    const furn = [...grouped.values()];

    const m = MODE_BY_ID[modeId];
    body.innerHTML = `
      <div class="card-title">
        <h3>${r.name}</h3>
        ${r.id === 'roomB' ? `<span class="key">本方案核心</span>` : ''}
        <span class="en">${r.en.toUpperCase()}</span>
      </div>
      <dl class="card-figures">
        <div><dt>面积</dt><dd>${r.area.toFixed(2)}<small> ㎡</small></dd></div>
        <div><dt>开间</dt><dd>${info.dims[0].replace('×', ' × ')}<small> m</small></dd></div>
        <div><dt>净高</dt><dd>2.75<small> m</small></dd></div>
      </dl>
      <p class="card-desc">${r.desc}</p>
      <div class="tagrow">
        <span class="tag oak">${info.floorName}</span>
        ${info.openings.map((o) => `<span class="tag">${o}</span>`).join('')}
        ${r.id === 'roomB' ? `<span class="tag oak">${m.tag.replace('第二间房 = ', '')}</span>` : ''}
      </div>
      <div class="card-sub">
        <b>家具清单 · ${info.items.length} 件${info.lampCount ? ` · ${info.lampCount} 处照明` : ''}</b>
        <span>${modeId === 'future' && r.id === 'roomB' ? '含小夜灯' : ''}</span>
      </div>
      <ul class="furn">
        ${furn.map((f) => `
          <li class="${f.added ? 'added' : ''}">
            <span class="nm">${FURNITURE_NAMES[f.t] || f.t}${f.lamp ? '<span class="lam">灯</span>' : ''}</span>
            <span class="qty">×${f.qty}</span>
          </li>`).join('')}
      </ul>
      ${r.id === 'roomB' ? `<p class="card-desc">${m.blurb}</p>` : ''}
    `;
  }

  /* ------------------------------ 对外 API ------------------------------ */
  function setLayout(id, notify) {
    if (!MODE_BY_ID[id]) return;
    layout = id;
    [...layoutWrap.children].forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    if (selected) renderCard(selected, layout);
    miniDirty = true;
    if (notify && handlers.onLayoutChange) handlers.onLayoutChange(id);
  }

  function setMode(m, notify) {
    if (!MODE_INFO[m]) return;
    mode = m;
    [...viewWrap.children].forEach((b) => b.classList.toggle('on', b.dataset.id === m));
    const info = MODE_INFO[m];
    $('hint-text').textContent = info.hint;
    $('minimap-tag').textContent = info.label;
    app.classList.toggle('mode-walk', m === 'walk');
    miniDirty = true;
    if (notify && handlers.onModeChange) handlers.onModeChange(m);
  }

  function setRoom(id, notify) {
    selected = id;
    [...list.children].forEach((li) => li.classList.toggle('on', li.dataset.id === id));
    renderCard(id, layout);
    miniDirty = true;
    if (notify && handlers.onSelectRoom) handlers.onSelectRoom(id);
  }

  function applyTime(h, notify) {
    const hh = ((h % 24) + 24) % 24;
    $('time-clock').textContent = fmtClock(hh);
    $('time-phase').textContent = phaseOf(hh);
    slider.value = String(Math.round(hh * 60) % 1440);
    const active = TIME_PRESETS.find((p) => Math.abs(p.h - hh) < 1 / 30);
    [...presetWrap.children].forEach((b) => b.classList.toggle('on', !!active && b === presetWrap.children[TIME_PRESETS.indexOf(active)]));
    if (notify && handlers.onTimeChange) handlers.onTimeChange(hh);
  }

  const api = {
    setLayout, setMode, setRoom, applyTime, drawMini, renderCard,
    get layout() { return layout; },
    get mode() { return mode; },
    get selected() { return selected; },
    set assets(list) { furnitureOutlines = list; miniDirty = true; },
    get labelsOn() { return labelsOn; },
    setAssetStatus(text) { $('asset-status').textContent = text; },
    setMiniTag(t) { $('minimap-tag').textContent = t; },

    revealHud() { hud.classList.add('on'); hud.setAttribute('aria-hidden', 'false'); },
    hideIntro() { intro.classList.add('off'); },
    setIntroProgress(p) { $('intro-progress').style.width = `${Math.round(p * 100)}%`; },
    setIntroStep(t) { $('intro-step').textContent = t; },
    onSkipIntro(fn) { $('intro-skip').addEventListener('click', fn); },
    bootDone() { boot.classList.add('off'); },
    setBootText(t) { $('boot-text').textContent = t; },
    fail(msg) {
      boot.classList.remove('off');
      const inner = boot.querySelector('.boot-inner');
      inner.innerHTML = `<div class="err">${msg}</div>`;
    },
    setLocked(locked) { app.classList.toggle('locked', locked); },
    setGlbToggle(v) { $('opt-glb').checked = v; },
  };

  setLayout('work', false);
  setMode('dollhouse', false);
  applyTime(10, false);
  return api;
}
