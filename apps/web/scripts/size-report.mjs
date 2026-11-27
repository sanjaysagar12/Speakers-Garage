// Build output sizes + project counts.   node scripts/size-report.mjs [distDir] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

const dist = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const kind = (f) => (f.endsWith('.gz') || f.endsWith('.br') || f.endsWith('stats.html') ? 'skip' : f.endsWith('.js') ? 'js' : f.endsWith('.css') ? 'css' : f.endsWith('.html') ? 'html' : 'assets');
const sum = { js: [0, 0, 0], css: [0, 0, 0], html: [0, 0, 0], assets: [0, 0, 0] };
const chunks = [];
for (const f of walk(dist)) {
  const k = kind(f);
  if (k === 'skip') continue;
  const b = fs.readFileSync(f);
  const gz = zlib.gzipSync(b, { level: 9 }).length;
  const br = zlib.brotliCompressSync(b).length;
  sum[k][0] += b.length;
  sum[k][1] += gz;
  sum[k][2] += br;
  if (k === 'js') chunks.push({ file: path.relative(dist, f), kb: +(b.length / 1024).toFixed(1), gzKB: +(gz / 1024).toFixed(1) });
}
const KB = (n) => +(n / 1024).toFixed(1);
const out = {
  dist,
  js: { rawKB: KB(sum.js[0]), gzipKB: KB(sum.js[1]), brotliKB: KB(sum.js[2]) },
  css: { rawKB: KB(sum.css[0]), gzipKB: KB(sum.css[1]) },
  html: { rawKB: KB(sum.html[0]) },
  assets: { rawKB: KB(sum.assets[0]), gzipKB: KB(sum.assets[1]) },
  chunks: chunks.sort((a, b) => b.kb - a.kb),
};
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const tracked = sh('git ls-files').split('\n').filter(Boolean);
const dirs = new Set(tracked.map((f) => path.dirname(f)));
const loc = (glob) => {
  const files = tracked.filter((f) => glob.test(f));
  return files.reduce((a, f) => a + fs.readFileSync(f, 'utf8').split('\n').length, 0);
};
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
out.project = {
  trackedFiles: tracked.length,
  trackedFolders: dirs.size,
  locSrc: loc(/^src\/.*\.(ts|tsx|css)$/),
  locScripts: loc(/^scripts\/.*\.(ts|mjs|js)$/),
  dependencies: Object.keys(pkg.dependencies ?? {}).length,
  devDependencies: Object.keys(pkg.devDependencies ?? {}).length,
  installedPackages: Number(sh('ls node_modules | wc -l')),
};
const i = process.argv.indexOf('--json');
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
