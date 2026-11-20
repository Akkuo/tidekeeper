// 重播已存的路線並每 30 幀印出玩家狀態（除錯用）
import fs from 'node:fs';
import { createGame } from '../src/core/game.js';
const n = +process.argv[2];
const silent = { setMuted() {}, setMusic() {}, sfx() {}, update() {}, toggleMute() { return false; }, unlock() {}, muted: false };
let seed = 1; Math.random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const g = createGame({ audio: silent }); g.startLevel(n - 1);
const r = JSON.parse(fs.readFileSync(new URL(`./routes/L${n}.json`, import.meta.url)));
const frames = r.input.flatMap(([k, c]) => Array(c).fill(k === '-' ? [] : k.split('+')));
let prev = [], f = 0;
for (const set of frames) {
  for (const k of ['left', 'right', 'jump', 'down', 'attack', 'tide']) { const on = set.includes(k); if (on && !prev.includes(k)) g.input.pressed[k] = true; g.input.down[k] = on; }
  g.update(1 / 60); prev = set; f++;
  const p = g.player;
  if (f % 30 === 0 || g.scene !== 'playing') console.log(f, g.scene, Math.round(p.x / 16), Math.round(p.y / 16), p.anim, g.tide.high ? 'H' : 'L', 'hp' + p.hp, set.join('+'));
  if (g.scene !== 'playing') break;
}
