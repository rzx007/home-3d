/**
 * labels.js —— 3D 房间标签（DOM 投影）
 *
 * 用 DOM 而不是 Sprite：文字永远是屏幕像素级清晰，样式也能直接跟着设计系统走。
 * 每帧把房间中心投影到屏幕坐标，超过相机背面或太远就隐藏。
 */
import * as THREE from 'three';
import { ROOMS } from './plan.js';

export function createLabels({ container, views }) {
  const root = document.createElement('div');
  root.className = 'labels';
  container.appendChild(root);

  const items = ROOMS.map((r) => {
    const el = document.createElement('div');
    el.className = `label${r.id === 'roomB' ? ' key' : ''}`;
    el.innerHTML = `<b>${r.name}</b><span>${r.area.toFixed(2)} ㎡</span>`;
    root.appendChild(el);
    return { room: r, el, pos: new THREE.Vector3(r.cx, 1.18, r.cz) };
  });

  const v = new THREE.Vector3();
  let visible = true;
  let lastMode = null;

  function update(mode) {
    if (!visible) return;
    const cam = views.camera;
    const W = container.clientWidth, H = container.clientHeight;
    for (const it of items) {
      v.copy(it.pos).project(cam);
      const behind = v.z > 1 || v.z < -1;
      const dist = it.pos.distanceTo(cam.position);
      const maxDist = mode === 'walk' ? 5.5 : 40;
      if (behind || dist > maxDist) { it.el.style.opacity = '0'; continue; }
      const x = (v.x * 0.5 + 0.5) * W;
      const y = (-v.y * 0.5 + 0.5) * H;
      if (x < -120 || x > W + 120 || y < -60 || y > H + 60) { it.el.style.opacity = '0'; continue; }
      // 漫游时靠近才淡入，避免贴脸
      const fade = mode === 'walk' ? THREE.MathUtils.clamp((maxDist - dist) / 1.6, 0, 1) : 1;
      it.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      it.el.style.opacity = String(fade * (mode === 'walk' ? 0.85 : 1));
      it.el.style.zIndex = String(1000 - Math.round(dist));
    }
    lastMode = mode;
  }

  return {
    update,
    setVisible(on) {
      visible = on;
      root.style.display = on ? '' : 'none';
      if (!on) for (const it of items) it.el.style.opacity = '0';
    },
    highlight(roomId, modeId) {
      for (const it of items) it.el.classList.toggle('on', it.room.id === roomId);
      const rb = items.find((i) => i.room.id === 'roomB');
      if (rb) rb.el.classList.toggle('key', true);
    },
    dispose() { root.remove(); },
  };
}
