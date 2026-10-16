/**
 * twod.js —— 2D 户型图渲染（Canvas2D）
 *
 * 同一套户型数据，画出建筑制图规范的户型图：墙体涂黑（poché）、洞口画窗三线、
 * 门画开启弧线、房间标注名称与面积、外侧标注总尺寸、指北针与比例尺。
 * 两处用途：
 *   · 开场动画：先把这张图铺在地面上（带描线动画），再让它"长出"3D 墙体；
 *   · 角落迷你地图：漫游时叠加相机位置。
 */
import { SHELL, ROOMS, WALLS, DOORS, roomAt } from './plan.js';
import { wallPieces } from './shell.js';

const C = {
  paper: '#f4f1ea',
  paperDark: '#e7e2d7',
  ink: '#3a3936',
  inkSoft: '#7d786e',
  oak: '#b98d5a',
  oakLight: '#d8c3a2',
  green: '#7c8a76',
  greenDeep: '#5c6957',
  white: '#fffdf8',
  roomWood: 'rgba(216,195,162,0.34)',
  roomTile: 'rgba(206,206,199,0.36)',
};

export function planTransform(canvasW, canvasH, pad) {
  const s = Math.min((canvasW - pad * 2) / SHELL.W, (canvasH - pad * 2) / SHELL.D);
  const ox = (canvasW - SHELL.W * s) / 2;
  const oy = (canvasH - SHELL.D * s) / 2;
  return { s, ox, oy };
}

/**
 * 把户型图画进 ctx。
 * opts.draw: 0–1 描线进度（横向擦除）
 * opts.mini: 迷你地图模式（省略标注与尺寸）
 */
export function drawPlan(ctx, opts = {}) {
  const {
    W = 1024, H = 768, pad = 46, draw = 1, mini = false,
    furniture = [], highlight = null, camera = null,
    labels = true, dims = true, north = true, mode = null, title = true,
  } = opts;

  const { s, ox, oy } = planTransform(W, H, mini ? 8 : pad);
  const X = (x) => ox + x * s;
  const Z = (z) => oy + z * s;
  const L = (v) => v * s;               // 长度换算
  const lw = mini ? 1.15 : 1.35;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W * draw, H);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* ---------- 图纸底 ---------- */
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.paperDark;
  const pl = SHELL.plot * 0.55;
  ctx.fillRect(X(-pl), Z(-pl), L(SHELL.W + pl * 2), L(SHELL.D + pl * 2));

  /* ---------- 房间地面色块 ---------- */
  for (const r of ROOMS) {
    for (const [x0, z0, x1, z1] of r.rects) {
      ctx.fillStyle = r.floor === 'wood' ? C.roomWood : C.roomTile;
      ctx.fillRect(X(x0), Z(z0), L(x1 - x0), L(z1 - z0));
    }
  }

  /* ---------- 家具轮廓 ---------- */
  for (const f of furniture) {
    const w = f.w ?? 0.4, d = f.d ?? 0.4;
    if (!w || !d) continue;
    ctx.save();
    ctx.translate(X(f.x), Z(f.z));
    ctx.rotate(-(f.rot || 0) * Math.PI / 180);
    ctx.strokeStyle = f.key ? C.greenDeep : (f.collide === false ? 'rgba(124,138,118,0.45)' : 'rgba(58,57,54,0.42)');
    ctx.fillStyle = f.key ? 'rgba(124,138,118,0.22)' : 'rgba(255,253,248,0.5)';
    ctx.lineWidth = lw * 0.85;
    const pw = L(w), pd = L(d);
    if (!mini) { ctx.fillRect(-pw / 2, -pd / 2, pw, pd); }
    ctx.strokeRect(-pw / 2, -pd / 2, pw, pd);
    ctx.restore();
  }

  /* ---------- 墙体 poché + 洞口 ---------- */
  for (const wall of WALLS) {
    const pieces = wallPieces(wall);
    for (const p of pieces) {
      if (p.y0 > 0.01 || p.y1 < SHELL.H - 0.01) continue; // 只填满高实体
      ctx.fillStyle = C.ink;
      const len = L(p.u1 - p.u0), th = L(wall.t);
      if (wall.axis === 'x') ctx.fillRect(X(p.u0), Z(wall.at) - th / 2, len, th);
      else ctx.fillRect(X(wall.at) - th / 2, Z(p.u0), th, len);
    }
    for (const op of wall.openings) {
      const len = L(op.b - op.a), th = L(wall.t);
      const cxU = (op.a + op.b) / 2;
      ctx.save();
      if (wall.axis === 'x') { ctx.translate(X(cxU), Z(wall.at)); }
      else { ctx.translate(X(wall.at), Z(cxU)); ctx.rotate(Math.PI / 2); }
      if (op.t === 'win') {
        // 窗：三线
        ctx.strokeStyle = C.white; ctx.lineWidth = th; ctx.beginPath();
        ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
        ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(0.7, lw * 0.55);
        for (const dz of [-th / 2 + 0.5, 0, th / 2 - 0.5]) {
          ctx.beginPath(); ctx.moveTo(-len / 2, dz); ctx.lineTo(len / 2, dz); ctx.stroke();
        }
        if (op.french) {
          ctx.lineWidth = lw;
          for (let i = 1; i < (op.panes || 3); i++) {
            const px = -len / 2 + (len / (op.panes || 3)) * i;
            ctx.beginPath(); ctx.moveTo(px, -th / 2); ctx.lineTo(px, th / 2); ctx.stroke();
          }
        }
      } else if (op.t === 'door') {
        ctx.strokeStyle = C.paper; ctx.lineWidth = th; ctx.beginPath();
        ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
        // 门套两侧
        ctx.strokeStyle = C.ink; ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(-len / 2, -th / 2); ctx.lineTo(-len / 2, th / 2);
        ctx.moveTo(len / 2, -th / 2); ctx.lineTo(len / 2, th / 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = C.paper; ctx.lineWidth = th; ctx.beginPath();
        ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
        ctx.strokeStyle = C.oak; ctx.lineWidth = lw * 0.8;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  /* ---------- 门扇 + 开启弧线 ---------- */
  for (const d of DOORS) {
    const wall = WALLS.find((w) => w.id === d.wall);
    const w = Math.abs(d.b - d.a);
    const leafLen = L(w);
    const isX = wall.axis === 'x';
    // 铰链世界坐标
    const [hx, hz] = [d.hinge[0], d.hinge[1]];
    const otherU = (isX ? (hx === d.a ? d.b : d.a) : (hz === d.a ? d.b : d.a));
    const dirAlong = (otherU - (isX ? hx : hz)) > 0 ? 1 : -1;
    ctx.save();
    ctx.translate(X(hx), Z(hz));
    const base = isX ? (dirAlong > 0 ? 0 : Math.PI) : (dirAlong > 0 ? -Math.PI / 2 : Math.PI / 2);
    ctx.rotate(-base);
    // 开启弧
    ctx.strokeStyle = 'rgba(58,57,54,0.35)';
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, leafLen, 0, Math.abs(d.openAngle), d.openAngle > 0);
    ctx.stroke();
    // 门扇（画在开启位置）
    ctx.fillStyle = C.oakLight;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = lw;
    ctx.save();
    ctx.rotate(-d.openAngle);
    ctx.beginPath();
    ctx.rect(0, -L(wall.t) * 0.22, leafLen, L(wall.t) * 0.44);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  /* ---------- 房间标注 ---------- */
  if (labels && !mini) {
    for (const r of ROOMS) {
      const isHl = highlight === r.id;
      ctx.fillStyle = isHl ? C.greenDeep : C.ink;
      ctx.textAlign = 'center';
      ctx.font = '600 21px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      ctx.fillText(r.name, X(r.cx), Z(r.cz) - 4);
      ctx.font = '400 16px "SF Mono",Consolas,monospace';
      ctx.fillStyle = isHl ? C.greenDeep : C.inkSoft;
      ctx.fillText(`${r.area.toFixed(2)} ㎡`, X(r.cx), Z(r.cz) + 18);
      if (isHl) {
        ctx.strokeStyle = C.green;
        ctx.lineWidth = 2;
        for (const [x0, z0, x1, z1] of r.rects) {
          ctx.strokeRect(X(x0) + 2, Z(z0) + 2, L(x1 - x0) - 4, L(z1 - z0) - 4);
        }
      }
    }
  }

  /* ---------- 总尺寸 ---------- */
  if (dims && !mini) {
    ctx.strokeStyle = C.inkSoft;
    ctx.fillStyle = C.inkSoft;
    ctx.lineWidth = 1;
    const dz = Z(SHELL.D) + 26;
    ctx.beginPath();
    ctx.moveTo(X(0), dz); ctx.lineTo(X(SHELL.W), dz);
    ctx.moveTo(X(0), dz - 5); ctx.lineTo(X(0), dz + 5);
    ctx.moveTo(X(SHELL.W), dz - 5); ctx.lineTo(X(SHELL.W), dz + 5);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '400 15px "SF Mono",Consolas,monospace';
    ctx.fillText(`${SHELL.W.toFixed(2)} m`, (X(0) + X(SHELL.W)) / 2, dz + 22);

    const dx = X(0) - 26;
    ctx.beginPath();
    ctx.moveTo(dx, Z(0)); ctx.lineTo(dx, Z(SHELL.D));
    ctx.moveTo(dx - 5, Z(0)); ctx.lineTo(dx + 5, Z(0));
    ctx.moveTo(dx - 5, Z(SHELL.D)); ctx.lineTo(dx + 5, Z(SHELL.D));
    ctx.stroke();
    ctx.save();
    ctx.translate(dx - 8, (Z(0) + Z(SHELL.D)) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${SHELL.D.toFixed(2)} m`, 0, -6);
    ctx.restore();
  }

  /* ---------- 指北针 / 比例尺 / 标题 ---------- */
  if (north && !mini) {
    const nx = W - pad - 4, ny = pad + 22;
    ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(nx, ny - 30); ctx.lineTo(nx - 9, ny + 6); ctx.lineTo(nx, ny);
    ctx.lineTo(nx + 9, ny + 6); ctx.closePath();
    ctx.fill();
    ctx.font = '600 14px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', nx, ny + 26);
  }
  if (!mini) {
    // 比例尺（2m）
    const bx = pad, by = H - pad + 18;
    ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + L(2), by);
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + L(2), by - 4); ctx.lineTo(bx + L(2), by + 4);
    ctx.stroke();
    ctx.font = '400 14px "SF Mono",Consolas,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('2 m', bx + L(2) + 8, by + 5);
    if (title) {
      ctx.font = '400 13px "SF Mono",Consolas,monospace';
      ctx.fillStyle = C.inkSoft;
      ctx.textAlign = 'right';
      ctx.fillText(`套内 62.56 ㎡ · 建筑 73.0 ㎡ · 层高 2.75 m${mode ? ` · ${mode}` : ''}`, W - pad, H - pad + 18);
    }
  }

  /* ---------- 迷你地图：相机 ---------- */
  if (camera && mini) {
    ctx.save();
    ctx.translate(X(camera.x), Z(camera.z));
    ctx.rotate(-camera.yaw + Math.PI); // yaw=0 时朝向 -Z（北）
    ctx.fillStyle = C.greenDeep;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.4); ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.white; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    const r = roomAt(camera.x, camera.z);
    if (r) {
      ctx.fillStyle = C.greenDeep;
      ctx.font = '600 12px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(r.name, 6, 14);
    }
  }

  ctx.restore();
  return { s, ox, oy };
}

export const PLAN_COLORS = C;
