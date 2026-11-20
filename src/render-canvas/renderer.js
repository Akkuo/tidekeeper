// Canvas 2D renderer：createRenderer(canvas, game) → { render(alpha), resize(w,h), destroy() }
// 遊戲狀態唯讀；世界畫在低解析度緩衝，再經 WebGL 後處理（或直接）放大到主畫布，HUD 以原生解析度繪製。
import { T, MENU, LEVEL_COUNT } from '../core/constants.js';
import { SPRITES } from '../core/sprite-data.js';
import { THEMES, LEVELS } from '../core/levels.js';
import { bossHead, bossSegments } from '../core/entities.js';
import { BRUSHES, BRUSH_NAMES } from '../core/editor.js';
import { buildSprites, buildTiles } from './sprites.js';
import { createPostFX } from './postfx.js';

const FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC",system-ui,sans-serif';
const fmt = t => { if (t == null) return '--:--.-'; const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`; };

export function createRenderer(canvas, game) {
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas'), b = buf.getContext('2d');
  const spr = buildSprites(SPRITES);
  const tiles = THEMES.map(th => buildTiles(th));
  let fx = createPostFX();
  let W = 1, H = 1, dpr = 1, lastEv = 0, lastT = performance.now(), rt = 0;
  const parts = [];

  function resize(w, h) {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = w; H = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  }

  // ---------- 粒子（只由事件產生，屬於 renderer 自己的狀態） ----------
  const P = (x, y, vx, vy, life, col, size = 1, grav = 200) => parts.push({ x, y, vx, vy, life, max: life, col, size, grav });
  function consumeEvents() {
    const th = THEMES[game.level ? game.level.theme : 0];
    for (const e of game.events) {
      if (e.id <= lastEv) continue;
      lastEv = e.id;
      const r = Math.random;
      switch (e.type) {
        case 'splash': for (let i = 0; i < 10; i++) P(e.x, e.y, (r() - 0.5) * 120, -60 - r() * 110, 0.6, '#cfefff', 1); break;
        case 'jump': case 'land': for (let i = 0; i < 5; i++) P(e.x, e.y, (r() - 0.5) * 60, -r() * 30, 0.35, 'rgba(255,255,255,0.7)', 1, 40); break;
        case 'dash': for (let i = 0; i < 6; i++) P(e.x, e.y + (r() - 0.5) * 10, (r() - 0.5) * 30, (r() - 0.5) * 30, 0.3, '#3ad6ff', 2, 0); break;
        case 'break': for (let i = 0; i < 12; i++) P(e.x, e.y, (r() - 0.5) * 200, -r() * 180, 0.9, th.rock, 2, 500); break;
        case 'kill': case 'hurt': case 'bosshit': for (let i = 0; i < (e.type === 'bosshit' ? 24 : 12); i++) P(e.x, e.y, (r() - 0.5) * 200, (r() - 0.5) * 200, 0.5, e.type === 'hurt' ? '#ff4d6d' : '#fff3a0', 2, 100); break;
        case 'pearl': case 'checkpoint': for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; P(e.x, e.y, Math.cos(a) * 70, Math.sin(a) * 70, 0.6, '#bff4ff', 1, 0); } break;
        case 'pop': for (let i = 0; i < 6; i++) P(e.x, e.y, (r() - 0.5) * 80, (r() - 0.5) * 80, 0.3, '#bff4ff', 1, 0); break;
        case 'bossdie': for (let i = 0; i < 80; i++) P(e.x + (r() - 0.5) * 60, e.y + (r() - 0.5) * 40, (r() - 0.5) * 260, (r() - 0.5) * 260, 1.6, i % 2 ? '#2fae9a' : '#fff36a', 2, 60); break;
        case 'tideup': case 'tidedown': case 'phase2': case 'roar': for (let i = 0; i < 30; i++) P(game.camera.x + r() * game.view.w, e.y, (r() - 0.5) * 40, e.type === 'tidedown' ? 60 : -90 - r() * 60, 0.8, '#cfefff', 1, 80); break;
        case 'thud': for (let i = 0; i < 14; i++) P(e.x, e.y, (r() - 0.5) * 160, (r() - 0.5) * 160, 0.5, '#9ff', 1, 0); break;
      }
    }
  }
  function stepParticles(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
    if (parts.length > 600) parts.splice(0, parts.length - 600);
  }

  // ---------- 背景 ----------
  function drawBackground(th, cx, cy, vw, vh, t) {
    const gr = b.createLinearGradient(0, 0, 0, vh);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(1, th.sky[1]);
    b.fillStyle = gr; b.fillRect(0, 0, vw, vh);
    const far = -cx * 0.15, near = -cx * 0.4, by = -cy * 0.2;
    b.save();
    switch (th.key) {
      case 'shore':
        b.fillStyle = 'rgba(255,250,210,0.9)'; b.beginPath(); b.arc(vw * 0.75, vh * 0.2 + by, 22, 0, 7); b.fill();
        b.fillStyle = 'rgba(255,255,255,0.7)';
        for (let i = 0; i < 5; i++) { const x = ((i * 140 + far * 0.6 + t * 6) % (vw + 120) + vw + 120) % (vw + 120) - 60; b.fillRect(x, 30 + i * 13 + by, 46, 6); b.fillRect(x + 10, 25 + i * 13 + by, 24, 5); }
        hills(far, vh * 0.62 + by, 28, 0.013, '#7fb7c8'); hills(near, vh * 0.72 + by, 20, 0.024, '#5e9aa0');
        break;
      case 'coral':
        b.fillStyle = 'rgba(200,255,255,0.08)';
        for (let i = 0; i < 6; i++) { const x = ((i * 90 + far) % (vw + 200) + vw + 200) % (vw + 200) - 100; b.beginPath(); b.moveTo(x, 0); b.lineTo(x + 30, 0); b.lineTo(x + 90 + Math.sin(t + i) * 10, vh); b.lineTo(x + 40, vh); b.fill(); }
        for (let i = 0; i < 14; i++) { const x = ((i * 47 + near) % (vw + 60) + vw + 60) % (vw + 60) - 30; coral(x, vh * 0.9 + by, 20 + (i * 13) % 25, i % 2 ? '#a0406a' : '#3a8a8a'); }
        break;
      case 'wreck':
        hills(far, vh * 0.75 + by, 14, 0.02, '#2a4a3c');
        b.strokeStyle = '#21382e'; b.lineWidth = 4;
        for (let i = 0; i < 6; i++) { const x = ((i * 70 + near) % (vw + 140) + vw + 140) % (vw + 140) - 70; b.beginPath(); b.arc(x, vh * 0.95 + by, 40, Math.PI * 1.1, Math.PI * 1.9); b.stroke(); }
        break;
      case 'crystal':
        for (let i = 0; i < 10; i++) {
          const x = ((i * 61 + far) % (vw + 100) + vw + 100) % (vw + 100) - 50, hgt = 40 + (i * 37) % 60;
          b.fillStyle = `rgba(197,140,255,${0.18 + 0.1 * Math.sin(t * 2 + i)})`;
          b.beginPath(); b.moveTo(x - 10, vh + by); b.lineTo(x, vh - hgt + by); b.lineTo(x + 12, vh + by); b.fill();
          b.beginPath(); b.moveTo(x + 20, by); b.lineTo(x + 26, hgt * 0.6 + by); b.lineTo(x + 32, by); b.fill();
        }
        break;
      case 'storm': {
        const lx = ((vw * 0.7 + far * 0.5) % (vw + 200) + vw + 200) % (vw + 200) - 100;
        b.fillStyle = '#2a2f38'; b.fillRect(lx - 8, vh * 0.25 + by, 16, vh); b.fillStyle = '#ffe27a'; b.fillRect(lx - 6, vh * 0.22 + by, 12, 8);
        const a = t * 1.2;
        b.fillStyle = 'rgba(255,240,170,0.13)'; b.beginPath(); b.moveTo(lx, vh * 0.25 + by);
        b.lineTo(lx + Math.cos(a) * 400, vh * 0.25 + by + Math.sin(a) * 60 - 30); b.lineTo(lx + Math.cos(a) * 400, vh * 0.25 + by + Math.sin(a) * 60 + 30); b.fill();
        hills(near, vh * 0.8 + by, 18, 0.03, '#252a33');
        b.strokeStyle = 'rgba(180,200,230,0.35)'; b.lineWidth = 1; b.beginPath();
        const wind = 6 + game.gust * 14;
        for (let i = 0; i < 60; i++) { const x = (i * 37 + t * 40 * i % 997) % vw, y = (i * 53 + t * 380) % vh; b.moveTo(x, y); b.lineTo(x - wind, y + 9); }
        b.stroke();
        if (game.flash > 0) { b.fillStyle = `rgba(230,240,255,${game.flash * 0.6})`; b.fillRect(0, 0, vw, vh); }
        break;
      }
      case 'abyss': {
        b.strokeStyle = 'rgba(90,106,255,0.25)'; b.lineWidth = 2;
        const ox = vw / 2 + far * 0.2, oy = vh * 0.5 + by;
        for (let k = 0; k < 4; k++) { b.beginPath(); for (let i = 0; i < 60; i++) { const a = i * 0.18 + t * 0.6 + k * 1.57, r = i * 3.2; b.lineTo(ox + Math.cos(a) * r, oy + Math.sin(a) * r * 0.5); } b.stroke(); }
        for (let i = 0; i < 30; i++) { b.fillStyle = `rgba(150,180,255,${0.3 + 0.3 * Math.sin(t * 2 + i)})`; b.fillRect(((i * 71 + far) % vw + vw) % vw, (i * 43 + t * 8) % vh, 1, 1); }
        break;
      }
    }
    b.restore();
    function hills(off, base, amp, freq, col) {
      b.fillStyle = col; b.beginPath(); b.moveTo(0, vh);
      for (let x = 0; x <= vw; x += 8) b.lineTo(x, base - Math.abs(Math.sin((x - off) * freq)) * amp - Math.sin((x - off) * freq * 2.7) * amp * 0.3);
      b.lineTo(vw, vh); b.fill();
    }
    function coral(x, y, h, col) {
      b.strokeStyle = col; b.lineWidth = 3; b.beginPath(); b.moveTo(x, y); b.lineTo(x, y - h);
      b.moveTo(x, y - h * 0.5); b.lineTo(x - h * 0.3, y - h * 0.8); b.moveTo(x, y - h * 0.65); b.lineTo(x + h * 0.35, y - h); b.stroke();
    }
  }

  // ---------- 世界 ----------
  function drawWorld(alpha, t) {
    const lv = game.level, th = THEMES[lv.theme], tl = tiles[lv.theme], vw = buf.width, vh = buf.height;
    const cam = game.camera;
    const cx = Math.round(cam.px + (cam.x - cam.px) * alpha), cy = Math.round(cam.py + (cam.y - cam.py) * alpha);
    drawBackground(th, cx, cy, vw, vh, t);
    const wy = Math.round(game.waterY - cy), wb = Math.min(vh, lv.h * T - cy);
    // 水體背層（讓背景在水下變暗）
    if (wy < wb) { b.fillStyle = th.deep; b.globalAlpha = 0.45; b.fillRect(0, Math.max(0, wy), vw, wb - Math.max(0, wy)); b.globalAlpha = 1; }
    b.save(); b.translate(-cx, -cy);
    // 地圖外（直式畫面或小關卡時看得到）填深色岩層
    b.fillStyle = th.dark;
    if (cy + vh > lv.h * T) b.fillRect(cx, lv.h * T, vw, cy + vh - lv.h * T);
    if (cx < 0) b.fillRect(cx, cy, -cx, vh);
    if (cx + vw > lv.w * T) b.fillRect(lv.w * T, cy, cx + vw - lv.w * T, vh);
    const x0 = Math.max(0, Math.floor(cx / T)), x1 = Math.min(lv.w - 1, Math.floor((cx + vw) / T));
    const y0 = Math.max(0, Math.floor(cy / T)), y1 = Math.min(lv.h - 1, Math.floor((cy + vh) / T));
    const solid = c => c === '#' || c === 'B' || c === 'W';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = lv.grid[y][x], px = x * T, py = y * T;
      if (c === '.') continue;
      const above = y > 0 ? lv.grid[y - 1][x] : '#';
      if (c === '#') b.drawImage(solid(above) ? tl.rock[(x * 7 + y * 3) & 3] : tl.rockTop[(x * 5 + y) & 3], px, py);
      else if (c === 'B') b.drawImage(tl.B, px, py);
      else if (c === 'W') b.drawImage(solid(above) ? tl.W : tl.Wtop, px, py);
      else if (c === '=') b.drawImage(tl.plank, px, py);
      else if (c === '^') b.drawImage(spr.urchin.a[0], px + 2, py + 8);
      else if (c === 'K') spikes(px, py, y > 0 && solid(lv.grid[y - 1][x]) && !(y + 1 < lv.h && solid(lv.grid[y + 1][x])), th);
      else if (c === 't') { b.fillStyle = th.water; b.globalAlpha = 0.5; b.fillRect(px, py + (above === 't' ? 0 : 3), T, above === 't' ? T : T - 3); b.globalAlpha = 1; if (above !== 't') { b.fillStyle = '#e0faff'; b.fillRect(px, py + 3 + Math.round(Math.sin(t * 3 + x)), T, 1); } }
      else if ((c === '<' || c === '>') && py + T > game.waterY) {
        b.fillStyle = 'rgba(220,250,255,0.35)';
        const d = c === '<' ? -1 : 1;
        for (let i = 0; i < 2; i++) { const ox = (((t * 90 * d + i * 8 + y * 5) % T) + T) % T; b.fillRect(px + ox, py + 4 + i * 7, 5, 1); }
      }
    }
    // 出口
    if (lv.exit && !game.boss) {
      const e = lv.exit, glow = 0.6 + 0.4 * Math.sin(t * 4);
      b.fillStyle = `rgba(58,214,255,${0.25 * glow})`; b.fillRect(e.x - 6, e.y - 10, T + 12, 2 * T + 10);
      b.fillStyle = '#2a7fff'; b.fillRect(e.x + 2, e.y, 3, 2 * T); b.fillRect(e.x + 11, e.y, 3, 2 * T); b.fillRect(e.x + 2, e.y, 12, 3);
      b.fillStyle = '#3ad6ff'; b.fillRect(e.x + 5, e.y + 3, 6, 2 * T - 3);
      b.fillStyle = '#ffffff'; b.fillRect(e.x + 7, e.y + 6 + ((t * 20) % 22), 2, 3);
    }
    // 實體（編輯器模式只顯示格子標記，不畫上一關殘留的實體）
    const editing = game.scene === 'editor';
    for (const e of editing ? [] : game.entities) {
      if (!e.alive) continue;
      const fr = Math.floor(e.t * 4) % 2 ? 'b' : 'a';
      if (e.type === 'crab') b.drawImage(spr.crab[fr][0], Math.round(e.x), Math.round(e.y));
      else if (e.type === 'jelly') { b.globalAlpha = e.stranded ? 0.55 : 0.9; b.drawImage(spr.jelly[e.stranded ? 'b' : fr][0], Math.round(e.x), Math.round(e.y) - 2); b.globalAlpha = 1; }
      else if (e.type === 'puffer') b.drawImage(spr.puffer[e.stranded ? 'b' : fr][e.dir > 0 ? 0 : 1], Math.round(e.x), Math.round(e.y) + (e.stranded ? 1 : 0));
      else if (e.type === 'pearl') { const bob = Math.round(Math.sin(e.t * 3) * 2); b.fillStyle = 'rgba(191,244,255,0.25)'; b.beginPath(); b.arc(e.x + 3, e.y + 3 + bob, 6, 0, 7); b.fill(); b.drawImage(spr.pearl.a[0], Math.round(e.x), Math.round(e.y) + bob); }
      else if (e.type === 'checkpoint') {
        b.fillStyle = '#d0d8e0'; b.fillRect(e.x + 3, e.y, 2, e.h);
        b.fillStyle = e.on ? '#3ad6ff' : '#7a8a99'; b.beginPath(); b.moveTo(e.x + 5, e.y + 1); b.lineTo(e.x + 15 + (e.on ? Math.sin(t * 6) * 2 : 0), e.y + 5); b.lineTo(e.x + 5, e.y + 9); b.fill();
      }
    }
    if (game.boss && !editing) drawBoss(game.boss, t, th);
    for (const pr of editing ? [] : game.projectiles) { b.strokeStyle = '#bff4ff'; b.lineWidth = 1; b.beginPath(); b.arc(pr.x, pr.y, 4, 0, 7); b.stroke(); b.fillStyle = 'rgba(191,244,255,0.3)'; b.fill(); }
    // 殘影
    const gp = game.ghostPose;
    if (gp && game.scene !== 'editor') { b.globalAlpha = 0.35; b.drawImage(playerFrame(gp.anim, t)[gp.facing > 0 ? 2 : 3], gp.x, gp.y); b.globalAlpha = 1; }
    // 玩家
    const p = game.player;
    if (p && game.scene !== 'editor' && game.scene !== 'title') {
      const px = Math.round(p.prevX + (p.x - p.prevX) * alpha), py = Math.round(p.prevY + (p.y - p.prevY) * alpha);
      if (!(p.invuln > 0 && Math.floor(p.invuln * 15) % 2)) {
        const fr = playerFrame(p.anim, p.animT), f = p.facing;
        if (p.anim === 'dash') { b.globalAlpha = 0.35; b.drawImage(fr[f > 0 ? 2 : 3], px - f * 8, py); b.globalAlpha = 1; }
        b.drawImage(fr[f > 0 ? 0 : 1], px, py);
        // 三叉戟
        const hx = f > 0 ? px + 9 : px + 1, hy = py + 8, len = p.anim === 'dash' ? 14 : 9;
        b.fillStyle = '#ffcf5a'; b.fillRect(Math.min(hx, hx + f * len), hy, len, 1);
        const tx = hx + f * len;
        b.fillStyle = '#e8fbff'; b.fillRect(tx, hy - 2, 1, 5); b.fillRect(tx + f, hy - 2, 1, 1); b.fillRect(tx + f, hy, 2 * f > 0 ? 2 : 1, 1); b.fillRect(tx + f, hy + 2, 1, 1);
      }
    }
    // 粒子
    for (const q of parts) { b.globalAlpha = Math.max(0, q.life / q.max); b.fillStyle = q.col; b.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size); }
    b.globalAlpha = 1;
    b.restore();
    // 水體前層 + 水面
    if (wy < wb) {
      b.fillStyle = th.water; b.globalAlpha = 0.28;
      b.beginPath(); b.moveTo(0, wb);
      for (let x = 0; x <= vw; x += 4) b.lineTo(x, wy + Math.sin((x + cx) * 0.12 + t * 3) * 1.5);
      b.lineTo(vw, wb); b.fill(); b.globalAlpha = 1;
      b.fillStyle = 'rgba(230,250,255,0.85)';
      const wrow = lv.grid[Math.floor(game.waterY / T)];
      for (let x = 0; x < vw; x += 2) { const c = wrow && wrow[Math.floor((x + cx) / T)]; if (c === '#' || c === 'B' || c === 'W') continue; b.fillRect(x, Math.round(wy + Math.sin((x + cx) * 0.12 + t * 3) * 1.5), 2, 1); }
      // 氣泡
      b.fillStyle = 'rgba(220,250,255,0.5)';
      for (let i = 0; i < 18; i++) { const bx = ((i * 97 - cx) % vw + vw) % vw, by = wb - ((t * (12 + i % 5 * 6) + i * 53) % Math.max(1, wb - wy)); if (by > wy + 2) b.fillRect(bx, by, 1, 1); }
    }
  }
  function playerFrame(anim, at) {
    const s = spr.player;
    if (anim === 'run') return Math.floor(at * 10) % 2 ? s.run1 : s.run2;
    return s[anim === 'dash' ? 'jump' : anim] || s.stand;
  }
  function spikes(px, py, down, th) {
    b.fillStyle = th.accent;
    for (let i = 0; i < 3; i++) {
      b.beginPath();
      if (down) { b.moveTo(px + 1 + i * 5, py); b.lineTo(px + 3.5 + i * 5, py + 12); b.lineTo(px + 6 + i * 5, py); }
      else { b.moveTo(px + 1 + i * 5, py + T); b.lineTo(px + 3.5 + i * 5, py + 4); b.lineTo(px + 6 + i * 5, py + T); }
      b.fill();
    }
    b.fillStyle = 'rgba(255,255,255,0.7)'; b.fillRect(px + 3, down ? py + 2 : py + 10, 1, 3);
  }
  function drawBoss(bs, t, th) {
    if (bs.state === 'dormant' || bs.state === 'dead') return;
    const segs = bossSegments(bs);
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      b.fillStyle = i % 2 ? '#16645c' : '#2fae9a'; b.beginPath(); b.arc(s.x, s.y, s.r, 0, 7); b.fill();
      b.fillStyle = '#fff36a'; b.fillRect(s.x - 1, s.y - s.r, 2, 2);
    }
    const hd = bossHead(bs), right = bs.trail[3].x <= bs.x ? (bs.state === 'tired' || bs.state === 'aim' ? bs.dir > 0 : true) : false;
    const flash = bs.hurtT > 0 && Math.floor(bs.hurtT * 20) % 2;
    if (bs.state === 'tired') { b.strokeStyle = `rgba(255,243,106,${0.5 + 0.5 * Math.sin(t * 12)})`; b.lineWidth = 2; b.beginPath(); b.arc(bs.x, bs.y, 14, 0, 7); b.stroke(); }
    if (bs.state === 'aim') { b.fillStyle = `rgba(255,61,110,${0.15 + 0.1 * Math.sin(t * 20)})`; b.fillRect(bs.arena.x0, bs.aimY - 8, bs.arena.x1 - bs.arena.x0, 16); }
    b.save(); if (flash) b.filter = 'brightness(3)';
    b.drawImage(spr.eelHead.a[right ? 0 : 1], Math.round(hd.x), Math.round(hd.y - 1));
    b.restore();
  }

  // ---------- HUD 與畫面（主畫布原生解析度，單位為 CSS px） ----------
  function text(s, x, y, size, col = '#fff', align = 'left', weight = 700) {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,10,25,0.6)'; ctx.fillText(s, x + Math.max(1, size / 14), y + Math.max(1, size / 14));
    ctx.fillStyle = col; ctx.fillText(s, x, y);
  }
  function panel(x, y, w, h, a = 0.55) { ctx.fillStyle = `rgba(4,16,34,${a})`; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); }
  const small = () => Math.max(12, Math.min(18, Math.min(W, H) / 36));

  function drawHUD() {
    const p = game.player, s = small(), sc = Math.max(2, Math.round(s / 6));
    panel(8, 8, Math.max(150, s * 11), s * 3.4);
    for (let i = 0; i < p.maxHp; i++) { ctx.globalAlpha = i < p.hp ? 1 : 0.25; ctx.drawImage(spr.heart.a[0], 16 + i * (7 * sc + 4), 14, 7 * sc, 6 * sc); }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = i < game.pearlsGot ? 1 : 0.25; ctx.drawImage(spr.pearl.a[0], 16 + 3 * (7 * sc + 4) + 6 + i * (6 * sc + 3), 14, 6 * sc, 6 * sc); }
    ctx.globalAlpha = 1;
    text(fmt(game.runTime), 16, 14 + 6 * sc + s * 0.9, s, '#e8fbff');
    if (!game.custom) text('最佳 ' + fmt(game.prog.best[game.levelIdx]), 16 + s * 5.2, 14 + 6 * sc + s * 0.9, s * 0.8, '#9fd8ff', 'left', 500);
    // 右上：關卡與潮汐
    const lv = game.level, tw = Math.max(170, s * 12);
    panel(W - tw - 8, 8, tw, s * 3.4);
    text(game.custom ? '自訂關卡' : `${game.levelIdx + 1}. ${lv.name}`, W - 16, 8 + s * 0.9, s, '#fff', 'right');
    const td = game.tide, label = td.high ? '滿潮' : '乾潮';
    text(`Q 潮汐：${label}`, W - 16, 8 + s * 2.3, s * 0.85, td.high ? '#3ad6ff' : '#ffd27a', 'right');
    const bw = s * 4, bx = W - 16 - s * 7.6 - bw, by = 8 + s * 2.3 - 3;
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx, by, bw, 6);
    ctx.fillStyle = td.high ? '#3ad6ff' : '#ffd27a'; ctx.fillRect(bx, by, bw * td.p, 6);
    if (td.cd > 0 || td.trans > 0) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(bx, by + 7, bw * (td.trans > 0 ? 1 : td.cd / 0.6), 2); }
    if (game.audio.muted) text('靜音（M）', W - 16, 8 + s * 4.2, s * 0.75, '#ffb0b0', 'right', 500);
    if (lv.wind && game.gust > 0.1) text('≋ 陣風 ≋', W / 2, H * 0.2, s * 1.1, `rgba(220,235,255,${game.gust})`, 'center');
    // Boss 血條
    const bs = game.boss;
    if (bs && game.bossActive && bs.state !== 'dead') {
      const w = Math.min(W * 0.5, 420), x = (W - w) / 2, y = 8 + s * 3.9;
      text('渦潮巨鰻' + (bs.phase === 2 ? '・狂潮' : ''), W / 2, y, s, '#ff9ab0', 'center');
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, y + s * 0.7, w, 8);
      ctx.fillStyle = bs.phase === 2 ? '#ff3d6e' : '#2fae9a'; ctx.fillRect(x, y + s * 0.7, w * Math.max(0, bs.hp) / bs.maxHp, 8);
    }
  }
  function drawHints(cam) {
    const lv = game.level, sx = W / buf.width, sy = H / buf.height, s = small() * 0.9;
    for (const h of lv.hints) {
      const x = (h.x - cam.x) * sx, y = (h.y - cam.y) * sy;
      if (x < -400 || x > W + 50 || y < -50 || y > H + 50) continue;
      ctx.font = `600 ${s}px ${FONT}`;
      const w = ctx.measureText(h.text).width + 16;
      panel(x - 8, y - s, w, s * 2, 0.45);
      text(h.text, x, y, s, '#e8fbff', 'left', 600);
    }
  }
  function overlay(title, lines, col = '#3ad6ff') {
    ctx.fillStyle = 'rgba(2,10,24,0.62)'; ctx.fillRect(0, 0, W, H);
    const s = small(), big = Math.min(W / 10, 56);
    text(title, W / 2, H * 0.36, big, col, 'center', 900);
    lines.forEach((l, i) => text(l, W / 2, H * 0.36 + big * 0.9 + i * s * 1.8, i === lines.length - 1 ? s * 0.9 : s * 1.1, i === lines.length - 1 ? '#9fd8ff' : '#fff', 'center', i === lines.length - 1 ? 500 : 700));
  }
  function drawTitle(t) {
    const s = small(), big = Math.min(W / 7.5, 110);
    ctx.fillStyle = 'rgba(2,16,40,0.38)'; ctx.fillRect(0, 0, W, H);
    const gr = ctx.createLinearGradient(W / 2 - big * 3, 0, W / 2 + big * 3, 0);
    gr.addColorStop(0, '#3ad6ff'); gr.addColorStop(1, '#2a7fff');
    ctx.save(); ctx.shadowColor = 'rgba(58,214,255,0.7)'; ctx.shadowBlur = 24;
    ctx.font = `900 ${big}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = gr;
    ctx.fillText('TIDEKEEPER', W / 2, H * 0.2 + Math.sin(t * 1.5) * 4); ctx.restore();
    text('潮汐守望者', W / 2, H * 0.2 + big * 0.75, big * 0.32, '#e8fbff', 'center', 800);
    text('切換滿潮與乾潮，讓整片海岸成為你的踏腳石', W / 2, H * 0.2 + big * 0.75 + big * 0.42, s, '#bfe9ff', 'center', 500);
    // 選關卡片
    const x0 = MENU.cardX0 * W, x1 = MENU.cardX1 * W, y0 = MENU.cardY0 * H, y1 = MENU.cardY1 * H, cw = (x1 - x0) / LEVEL_COUNT;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      const x = x0 + i * cw + 3, w = cw - 6, locked = i >= game.prog.unlocked, sel = i === game.sel;
      ctx.fillStyle = sel ? 'rgba(58,214,255,0.32)' : 'rgba(4,16,34,0.55)'; ctx.beginPath(); ctx.roundRect(x, y0, w, y1 - y0, 10); ctx.fill();
      if (sel) { ctx.strokeStyle = '#3ad6ff'; ctx.lineWidth = 2; ctx.stroke(); }
      const fs = Math.min(w / 5.2, s * 1.1);
      text(String(i + 1), x + w / 2, y0 + (y1 - y0) * 0.22, fs * 1.6, locked ? '#556' : '#fff', 'center', 900);
      text(locked ? '未解鎖' : LEVELS[i].name, x + w / 2, y0 + (y1 - y0) * 0.5, fs, locked ? '#667' : '#e8fbff', 'center', 700);
      if (!locked) {
        text(fmt(game.prog.best[i]), x + w / 2, y0 + (y1 - y0) * 0.7, fs * 0.8, '#9fd8ff', 'center', 500);
        text('●'.repeat(game.prog.pearls[i] | 0) + '○'.repeat(3 - (game.prog.pearls[i] | 0)), x + w / 2, y0 + (y1 - y0) * 0.87, fs * 0.75, '#bff4ff', 'center', 500);
      }
    }
    const blink = 0.55 + 0.45 * Math.sin(t * 4);
    text('Enter / Space / 點擊 開始', W / 2, H * 0.76, s * 1.3, `rgba(255,255,255,${blink})`, 'center', 800);
    const narrow = W < 700;
    const lines = narrow
      ? ['←/→ 或 1–6 選關・A/D 移動・Space 跳', 'X/J 突刺・Q 潮汐・↓ 下潛・P 暫停・M 靜音', 'F2 關卡編輯器・V 後處理開關']
      : ['←/→ 或 1–6 選關　A/D ←/→ 移動　Space/W/↑ 跳　X/J 三叉戟突刺', 'Q 切換潮汐　↓ 水中下潛　P/Esc 暫停　M 靜音　V 後處理開關　F2 關卡編輯器'];
    lines.forEach((l, i) => text(l, W / 2, H * 0.84 + i * s * 1.6, s * 0.9, '#cfe8ff', 'center', 500));
  }
  function drawEditorOverlay(t) {
    const ed = game.editor, s = small(), sx = W / buf.width, sy = H / buf.height;
    // 格線 + 游標
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.floor(ed.camX / T); x * T < ed.camX + buf.width; x++) { const X = Math.round((x * T - ed.camX) * sx) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, H); }
    for (let y = Math.floor(ed.camY / T); y * T < ed.camY + buf.height; y++) { const Y = Math.round((y * T - ed.camY) * sy) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(W, Y); }
    ctx.stroke();
    // 實體標記（編輯器裡沒有生成實體，直接標字）
    ctx.font = `800 ${Math.max(10, T * sx * 0.6)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let y = 0; y < ed.h; y++) for (let x = 0; x < ed.w; x++) {
      const c = ed.grid[y][x];
      if (!'SECocjpX'.includes(c)) continue;
      const X = (x * T + 8 - ed.camX) * sx, Y = (y * T + 8 - ed.camY) * sy;
      if (X < -20 || X > W + 20 || Y < -20 || Y > H + 20) continue;
      ctx.fillStyle = { S: '#7dff9a', E: '#3ad6ff', C: '#ffffff', o: '#bff4ff', c: '#ff6a4a', j: '#ff8ad8', p: '#ffd84a', X: '#ff3d6e' }[c];
      ctx.fillText(c === 'S' ? '起' : c === 'E' ? '終' : c === 'C' ? '旗' : c === 'o' ? '珠' : c === 'c' ? '蟹' : c === 'j' ? '母' : c === 'p' ? '豚' : '鰻', X, Y);
    }
    if (ed.cursor.x >= 0) { ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2; ctx.strokeRect((ed.cursor.x * T - ed.camX) * sx, (ed.cursor.y * T - ed.camY) * sy, T * sx, T * sy); }
    panel(8, 8, W - 16, s * 2.2);
    text('關卡編輯器　左鍵畫・右鍵擦・方向鍵捲動・1–9/0、[ ] 筆刷・G 配色・Q 潮汐預覽・T 試玩・X 匯出・L 載入・N 新建・F2/Esc 離開', 16, 8 + s * 1.1, s * 0.78, '#e8fbff', 'left', 600);
    const bh = s * 2.4, by = H - bh - 8;
    panel(8, by, W - 16, bh);
    const cw = (W - 32) / BRUSHES.length;
    BRUSHES.forEach((c, i) => {
      const x = 16 + i * cw;
      if (i === ed.brush) { ctx.fillStyle = 'rgba(58,214,255,0.35)'; ctx.fillRect(x, by + 4, cw - 4, bh - 8); }
      text(BRUSH_NAMES[c], x + cw / 2 - 2, by + bh / 2, Math.min(s * 0.75, cw / 3.2), i === ed.brush ? '#fff' : '#9fb8cc', 'center', 600);
    });
    if (ed.msgT > 0) text(ed.msg, W / 2, by - s * 1.2, s, `rgba(255,230,130,${Math.min(1, ed.msgT)})`, 'center');
  }

  function render(alpha) {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; rt += dt;
    const vw = game.view.w, vh = game.view.h;
    if (buf.width !== vw || buf.height !== vh) { buf.width = vw; buf.height = vh; }
    b.imageSmoothingEnabled = false;
    consumeEvents(); stepParticles(dt);
    const sc = game.scene;
    if (game.level && sc !== 'title' && !(sc === 'win' && !game.player)) drawWorld(alpha, rt);
    else drawBackground(THEMES[game.sel % 6], rt * 30, 0, vw, vh, rt), drawTitleWater(vw, vh, rt);
    // 合成到主畫布
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    let out = null;
    if (fx && game.settings.fx) {
      const cam = game.camera, under = sc === 'title' ? 0.72 : (game.waterY - cam.y) / vh;
      out = fx.run(buf, { waterUV: under, time: rt, ripple: 1, bloom: 0.6 });
      if (!out) fx = null;
    }
    ctx.drawImage(out || buf, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sc === 'title') { drawTitle(rt); return; }
    if (sc === 'editor') { drawEditorOverlay(rt); return; }
    const cam = game.camera;
    drawHints({ x: cam.px + (cam.x - cam.px) * alpha, y: cam.py + (cam.y - cam.py) * alpha });
    drawHUD();
    const r = game.result, s = small();
    if (sc === 'paused') overlay('已暫停', ['P / Esc / Enter 繼續', 'R 重新開始', '水中按 ↓ 下潛・Q 切換潮汐', 'Q 回標題（或回編輯器）'], '#3ad6ff');
    else if (sc === 'clear') overlay('關卡完成！', [`時間 ${fmt(r.time)}${r.newBest ? '　★ 新紀錄' : ''}`, `潮之珠 ${r.pearls} / ${r.total}`, r.best != null ? `最佳 ${fmt(r.best)}` : '自訂關卡', 'Enter 下一關・R 重玩・Q 回標題'], '#7dffb0');
    else if (sc === 'lose') overlay('被浪捲走了……', ['潮汐不等人', game.checkpoint ? 'Enter：從檢查點重來' : 'Enter：從起點重來', 'R 整關重新開始・Q 回標題'], '#ff6a8a');
    else if (sc === 'win') overlay('深淵平息了', ['渦潮巨鰻沉入海底，潮汐重歸平靜', `最終關時間 ${fmt(r && r.time)}`, `六關最佳合計 ${fmt(Object.values(game.prog.best).reduce((a, v) => a + v, 0))}`, 'Enter 回標題'], '#ffe27a');
    void s;
  }
  function drawTitleWater(vw, vh, t) {
    const wy = vh * 0.72;
    b.fillStyle = '#0b4f9e'; b.globalAlpha = 0.6; b.beginPath(); b.moveTo(0, vh);
    for (let x = 0; x <= vw; x += 4) b.lineTo(x, wy + Math.sin(x * 0.05 + t * 2) * 3 + Math.sin(x * 0.13 - t * 3) * 1.5);
    b.lineTo(vw, vh); b.fill(); b.globalAlpha = 1;
    b.drawImage(spr.player.stand[0], Math.round(vw / 2 - 5), Math.round(wy - 12 + Math.sin(t * 2) * 2));
    b.drawImage(spr.jelly[Math.floor(t * 4) % 2 ? 'a' : 'b'][0], Math.round(vw * 0.3), Math.round(wy + 20 + Math.sin(t) * 6));
    b.drawImage(spr.puffer.a[1], Math.round((t * 25) % (vw + 40) - 20), Math.round(wy + 40));
  }

  return { render, resize, destroy() { if (fx) fx.destroy(); fx = null; } };
}
