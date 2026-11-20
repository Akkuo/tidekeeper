# TIDEKEEPER 潮汐守望者

切換「滿潮／乾潮」的橫向平台動作遊戲。按下 Q，整片海岸的水位會在 0.5 秒內漲落：滿潮時游泳、隨水位浮上高處；乾潮時露出海床、潮池與尖刺海膽，逆流洞穴也才走得過去。六大關各有地形、配色、危害與 BGM，最終關對上會強制改變潮汐的 Boss「渦潮巨鰻」。

- 線上遊玩：https://akkuo.github.io/tidekeeper/
- 離線單檔版：`dist/index.html`（雙擊即可開啟）

## 操作

| 動作 | 鍵盤 | 觸控 |
|---|---|---|
| 移動 | A / D 或 ← / → | 左側搖桿 |
| 跳（土狼時間、跳躍緩衝、按久跳更高）／水中划水 | Space / W / ↑ | 跳 |
| 三叉戟突刺（短衝刺，擊破易碎牆、擊敗敵人） | X / J | 刺 |
| 切換潮汐（0.5 秒過渡、0.6 秒冷卻） | Q | 潮 |
| 水中下潛 | ↓ / S | 搖桿往下 |
| 暫停 | P / Esc | ⏸ |
| 靜音 | M | — |
| 後處理（bloom＋水下折射）開關 | V | — |
| 選關（已解鎖） | 1–6 或 ← / → | 點選關卡卡片 |
| 關卡編輯器 | F2 | —（僅桌機） |

編輯器：左鍵畫、右鍵擦、方向鍵捲動、1–9/0 或 `[` `]` 換筆刷、G 換配色、Q 預覽滿潮、T 試玩、X 匯出 JSON 到剪貼簿（同時存 localStorage）、L 載入、N 新建、F2/Esc 離開。

## 技術重點

- 原生 Canvas 2D、零相依；ES modules 放 `src/`，無需建置即可在 GitHub Pages 遊玩。
- `src/core/`：純邏輯（常數、關卡資料、物理、實體、Boss、狀態機、輸入抽象、Web Audio 合成、編輯器邏輯、Ghost 紀錄、點陣資料），不含任何 Canvas/DOM 繪圖，可直接在 Node 執行（供 Pixi 版逐位元組共用）。
- `src/render-canvas/`：`createRenderer(canvas, game) → { render(alpha), resize(w,h), destroy() }`，遊戲狀態唯讀。世界畫在低解析度緩衝，再經自寫 WebGL 後處理（亮部擷取 → 半解析度兩段高斯模糊的 bloom、水線以下的波紋折射與焦散、暗角）放大到主畫布；WebGL 不可用時自動退回純 2D。HUD 以 devicePixelRatio（上限 2）原生解析度繪製。
- 固定 60Hz 邏輯步長 + 插值繪製；零外部素材：所有圖形為程式繪製／點陣字串，音效與六首 BGM 皆由 Web Audio 即時合成。
- Ghost 殘影：每關最佳紀錄的移動軌跡存在 localStorage，下次半透明重播。
- `build-standalone.mjs`（Node、零相依）：把所有模組依相依順序包成單一 `<script>`，輸出 `dist/index.html`。

```
node build-standalone.mjs
```

自動驗證掛鉤：`window.__debug()` 回傳狀態快照、`window.__start()` 直接開始；網址加 `?autostart=1`（可加 `&level=N`）跳過標題。
