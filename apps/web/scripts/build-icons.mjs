// Renders the PNG icons and the Open Graph image from public/favicon.svg (run after changing the mark):
//   node scripts/build-icons.mjs
import sharp from 'sharp';
import fs from 'node:fs';

const mark = fs.readFileSync('public/favicon.svg');
for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await sharp(mark, { density: Math.ceil((72 * size) / 64) }).resize(size, size).png().toFile(`public/${file}`);
  console.log('wrote public/' + file);
}
const og = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DDF0EA"/><stop offset="1" stop-color="#9FCFC4"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <g transform="translate(90 219) scale(3)">${mark.toString().replace(/<\/?svg[^>]*>/g, '').replace(/<title>.*<\/title>/, '')}</g>
  <text x="310" y="300" font-family="'Baloo 2','Trebuchet MS',sans-serif" font-size="76" font-weight="800" fill="#2E4A35">Speaker's <tspan fill="#4F7A42">Garage</tspan></text>
  <text x="313" y="362" font-family="'Trebuchet MS',sans-serif" font-size="30" fill="#4A3A2C">Hang out in a shared world and talk to whoever is nearby.</text>
</svg>`);
await sharp(og).png().toFile('public/og-image.png');
console.log('wrote public/og-image.png');
