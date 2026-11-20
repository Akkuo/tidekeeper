// 零相依打包：把 src/ 的 ES modules 依相依順序包成單一 <script>，輸出可離線雙擊開啟的 dist/index.html
// 支援的語法（本專案自我約束）：單行 `import { a, b as c } from './x.js';`、`export function/const/let/class name`。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(root, 'src', 'main.js');
const modules = new Map(); // abs path → { id, code }
const order = [];

function load(file, stack = []) {
  if (modules.has(file)) return;
  if (stack.includes(file)) throw new Error('循環 import：' + [...stack, file].join(' → '));
  const src = fs.readFileSync(file, 'utf8');
  const id = path.relative(root, file).replace(/\\/g, '/');
  const exportsList = [];
  let code = src.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm, (m, names, spec) => {
    const dep = path.resolve(path.dirname(file), spec);
    load(dep, [...stack, file]);
    const binds = names.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${binds} } = __m[${JSON.stringify(path.relative(root, dep).replace(/\\/g, '/'))}];`;
  });
  if (/^\s*import\s/m.test(code)) throw new Error(`${id}: 有不支援的 import 寫法`);
  code = code.replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => { exportsList.push(name); return `${kind} ${name}`; });
  if (/^\s*export\s/m.test(code)) throw new Error(`${id}: 有不支援的 export 寫法`);
  modules.set(file, { id, code, exportsList });
  order.push(file);
}
load(entry);

let bundle = '(function () {\n"use strict";\nconst __m = {};\n';
for (const f of order) {
  const m = modules.get(f);
  bundle += `// ---- ${m.id} ----\n__m[${JSON.stringify(m.id)}] = (function () {\n${m.code}\nreturn { ${m.exportsList.join(', ')} };\n})();\n`;
}
bundle += '})();\n';
if (bundle.includes('</script')) throw new Error('程式碼中含有 </script，無法內嵌');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tag = /<script type="module" src="src\/main\.js"><\/script>/;
if (!tag.test(html)) throw new Error('index.html 找不到 src/main.js 的 script 標籤');
const out = html.replace(tag, () => `<script>\n${bundle}</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), out);
console.log(`dist/index.html：${order.length} 個模組，${(out.length / 1024).toFixed(1)} KB`);
for (const f of order) console.log('  ' + modules.get(f).id);
