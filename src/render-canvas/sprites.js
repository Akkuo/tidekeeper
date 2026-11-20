// 點陣 → canvas；磚塊材質程式產生（每個主題快取一次）
import { T } from '../core/constants.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function bake(rows, pal, flip, tint) {
  const h = rows.length, w = rows[0].length, c = mk(w, h), x = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const ch = rows[y][i];
    if (ch === '.' || !pal[ch]) continue;
    x.fillStyle = tint || pal[ch];
    x.fillRect(flip ? w - 1 - i : i, y, 1, 1);
  }
  return c;
}

// 回傳 { name: { frame: [右向, 左向, 殘影右, 殘影左] } }
export function buildSprites(defs) {
  const out = {};
  for (const [name, d] of Object.entries(defs)) {
    out[name] = {};
    for (const [f, rows] of Object.entries(d.frames)) {
      out[name][f] = [bake(rows, d.pal, false), bake(rows, d.pal, true)];
      if (name === 'player') out[name][f].push(bake(rows, d.pal, false, '#bff4ff'), bake(rows, d.pal, true, '#bff4ff'));
    }
  }
  return out;
}

const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// 主題磚塊：rock[4]、rockTop[4]、B、W、Wtop、plank
export function buildTiles(th) {
  const t = { rock: [], rockTop: [] };
  for (let v = 0; v < 4; v++) {
    for (const top of [false, true]) {
      const c = mk(T, T), x = c.getContext('2d');
      x.fillStyle = th.rock; x.fillRect(0, 0, T, T);
      for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
        const r = hash(i + v * 31, j + v * 17);
        if (r < 0.12) { x.fillStyle = shade(th.rock, 0.78); x.fillRect(i, j, 1, 1); }
        else if (r > 0.94) { x.fillStyle = shade(th.rock, 1.15); x.fillRect(i, j, 1, 1); }
      }
      x.fillStyle = shade(th.rock, 0.85); x.fillRect(0, T - 1, T, 1);
      x.fillStyle = th.dark; x.fillRect((v * 5) % 12 + 1, 6 + v, 3, 2); x.fillRect((v * 9 + 6) % 13, 11, 2, 2);
      if (top) {
        x.fillStyle = th.top; x.fillRect(0, 0, T, 3);
        for (let i = 0; i < T; i++) if (hash(i, v) > 0.5) x.fillRect(i, 3, 1, 1 + (hash(v, i) > 0.7 ? 1 : 0));
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(0, 0, T, 1);
      }
      (top ? t.rockTop : t.rock).push(c);
    }
  }
  // 易碎牆：裂紋方塊
  let c = mk(T, T), x = c.getContext('2d');
  x.fillStyle = shade(th.rock, 1.2); x.fillRect(0, 0, T, T);
  x.fillStyle = shade(th.rock, 0.6); x.fillRect(0, 0, T, 1); x.fillRect(0, 0, 1, T); x.fillRect(T - 1, 0, 1, T); x.fillRect(0, T - 1, T, 1);
  x.strokeStyle = th.dark; x.lineWidth = 1; x.beginPath(); x.moveTo(3, 2); x.lineTo(7, 7); x.lineTo(5, 12); x.moveTo(7, 7); x.lineTo(13, 9); x.moveTo(10, 3); x.lineTo(8, 6); x.stroke();
  t.B = c;
  // 濕滑地：亮面反光
  for (const key of ['W', 'Wtop']) {
    c = mk(T, T); x = c.getContext('2d');
    x.fillStyle = shade(th.rock, 0.9); x.fillRect(0, 0, T, T);
    x.fillStyle = 'rgba(160,220,255,0.35)'; x.fillRect(0, 0, T, T);
    for (let i = 0; i < 5; i++) { x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect((i * 7) % 14 + 1, (i * 5) % 12 + 3, 2, 1); }
    if (key === 'Wtop') { x.fillStyle = '#cdf3ff'; x.fillRect(0, 0, T, 2); x.fillStyle = '#ffffff'; x.fillRect(2, 0, 4, 1); x.fillRect(10, 0, 3, 1); }
    t[key] = c;
  }
  // 單向木板
  c = mk(T, T); x = c.getContext('2d');
  x.fillStyle = '#a8743c'; x.fillRect(0, 0, T, 5);
  x.fillStyle = '#d9a35f'; x.fillRect(0, 0, T, 1);
  x.fillStyle = '#6a4220'; x.fillRect(0, 4, T, 1); x.fillRect(7, 1, 1, 3);
  x.fillStyle = '#6a4220'; x.fillRect(2, 5, 2, 3); x.fillRect(12, 5, 2, 3);
  t.plank = c;
  return t;
}
