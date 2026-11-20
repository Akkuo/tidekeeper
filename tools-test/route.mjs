// 通關證明：直接驅動 src/core/，以 beam search 產生「每幀按鍵時間軸」，再從全新狀態重播驗證。
// 用法：node tools-test/route.mjs [關卡 1-6 ...]   （不給參數＝全部）
// 輸出：tools-test/routes/L<n>.json（RLE 壓縮的每幀輸入），重播結果印在終端機。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/core/game.js';
import { bossHead } from '../src/core/entities.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEG = 10, BEAM = 24;
const silent = { setMuted() {}, setMusic() {}, sfx() {}, update() {}, toggleMute() { return false; }, unlock() {}, muted: false };
let seed = 1;
Math.random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function fresh(idx) { seed = 1; const g = createGame({ audio: silent }); g.startLevel(idx); return g; }
const KEYS = ['left', 'right', 'jump', 'down', 'attack', 'tide'];
// 每個動作：持續按住的鍵 + 只在第一幀按的鍵
const ACTIONS = [['right'], ['right', 'jump'], ['left'], ['left', 'jump'], ['jump'], [], ['right', 'down'], ['down'],
  ['right', '+tide'], ['+tide'], ['right', '+attack'], ['left', '+attack'], ['right', 'jump', '+attack']];
const frameSets = act => Array.from({ length: SEG }, (_, i) => act.filter(k => !k.startsWith('+') || i === 0).map(k => k.replace('+', '')));

function step(g, set, prev) {
  for (const k of KEYS) { const on = set.includes(k); if (on && !prev.includes(k)) g.input.pressed[k] = true; g.input.down[k] = on; }
  g.update(1 / 60);
}
const save = g => structuredClone({ player: g.player, entities: g.entities, projectiles: g.projectiles, boss: g.boss, tide: g.tide,
  waterY: g.waterY, grid: g.level.grid, runTime: g.runTime, pearlsGot: g.pearlsGot, checkpoint: g.checkpoint, time: g.time,
  frame: g.frame, scene: g.scene, sceneT: g.sceneT, gust: g.gust, flash: g.flash, bossActive: g.bossActive });
function load(g, s) {
  const c = structuredClone(s);
  Object.assign(g, { player: c.player, entities: c.entities, projectiles: c.projectiles, boss: c.boss, tide: c.tide, waterY: c.waterY,
    runTime: c.runTime, pearlsGot: c.pearlsGot, checkpoint: c.checkpoint, time: c.time, frame: c.frame, scene: c.scene,
    sceneT: c.sceneT, gust: c.gust, flash: c.flash, bossActive: c.bossActive });
  g.level.grid = c.grid; g.input.down = {}; g.input.pressed = {};
}
function score(g) {
  const p = g.player, b = g.boss;
  let s = p.x + p.hp * 120;
  if (b && b.state !== 'dormant') {
    s = 20000 - b.hp * 1000 + p.hp * 150;
    if (b.state === 'tired') { const h = bossHead(b); s -= Math.hypot(p.x + 5 - (h.x + 9), p.y + 7 - (h.y + 7)); }
    else s -= Math.abs(p.x - (b.arena.x0 + b.arena.x1) / 2) * 0.05;
  }
  return s;
}

function search(idx) {
  const g = fresh(idx);
  let beam = [{ st: save(g), acts: [], last: [] }];
  let best = -1e9, stale = 0;
  for (let it = 0; it < 3000; it++) {
    const next = [];
    for (const n of beam) for (let a = 0; a < ACTIONS.length; a++) {
      load(g, n.st);
      let prev = n.last;
      for (const set of frameSets(ACTIONS[a])) { step(g, set, prev); prev = set; if (g.scene !== 'playing') break; }
      if (g.scene === 'clear' || g.scene === 'win') return [...n.acts, a];
      if (g.scene !== 'playing') continue;
      const p = g.player;
      next.push({ st: save(g), acts: [...n.acts, a], last: prev, sc: score(g), key: `${Math.round(p.x / 6)},${Math.round(p.y / 6)},${g.tide.high},${p.hp},${g.boss ? g.boss.hp : 0}` });
    }
    next.sort((x, y) => y.sc - x.sc);
    const seen = new Set(); beam = [];
    for (const n of next) { if (seen.has(n.key)) continue; seen.add(n.key); beam.push(n); if (beam.length >= BEAM) break; }
    if (!beam.length) return null;
    if (beam[0].sc > best + 1) { best = beam[0].sc; stale = 0; } else if (++stale > (g.boss && g.boss.state !== 'dormant' ? 500 : 80)) { console.log('  停滯：', JSON.stringify(g.snapshot().boss), 'best', Math.round(best)); return null; }
  }
  return null;
}

// 把動作序列展開成每幀輸入，從全新狀態重播驗證
function replay(idx, acts) {
  const g = fresh(idx), frames = acts.flatMap(a => frameSets(ACTIONS[a]));
  let prev = [], minHp = 3;
  for (const set of frames) { step(g, set, prev); prev = set; minHp = Math.min(minHp, g.player.hp); if (g.scene !== 'playing') break; }
  return { frames, scene: g.scene, time: g.result ? +g.result.time.toFixed(2) : null, pearls: g.pearlsGot, minHp, boss: g.boss && g.boss.state };
}
const rle = frames => { const out = []; for (const f of frames) { const k = f.join('+') || '-'; if (out.length && out[out.length - 1][0] === k) out[out.length - 1][1]++; else out.push([k, 1]); } return out; };

const want = process.argv.slice(2).map(Number).filter(Boolean);
fs.mkdirSync(path.join(here, 'routes'), { recursive: true });
for (const n of want.length ? want : [1, 2, 3, 4, 5, 6]) {
  const t0 = Date.now(), acts = search(n - 1);
  if (!acts) { console.log(`L${n}: 找不到通關序列（${((Date.now() - t0) / 1000).toFixed(0)}s）`); process.exitCode = 1; continue; }
  const r = replay(n - 1, acts);
  if (r.scene !== (n === 6 ? 'win' : 'clear')) { console.error(`L${n}: 重播未通關（${r.scene}）`); process.exitCode = 1; continue; }
  fs.writeFileSync(path.join(here, 'routes', `L${n}.json`), JSON.stringify({ level: n, frames: r.frames.length, result: r.scene, time: r.time, input: rle(r.frames) }));
  console.log(`L${n}: 重播結果=${r.scene} 輸入幀數=${r.frames.length} 通關時間=${r.time}s 潮之珠=${r.pearls} 最低HP=${r.minHp}${r.boss ? ' boss=' + r.boss : ''}（搜尋 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
}
