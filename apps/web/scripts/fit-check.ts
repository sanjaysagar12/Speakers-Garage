// Avatar poke-through test: pnpm test:fit [-- --n 600 --seed 1 --no-zfight]
// Builds every avatar combination (or a seeded sample covering every option pair) and checks garments,
// hats, hair and glasses against the body rig. Exits non-zero on any failure, grouped by item.
import { fullProduct, groupFailures, runFitCheck } from '../src/game/models/character/fitCheck';

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const n = Number(arg('n', '600'));
const seed = Number(arg('seed', '1'));
const zfight = !process.argv.includes('--no-zfight');

console.log(`full product: ${fullProduct()} combinations (1 body shape x hair x hat x top x bottom x shoes x accessory)`);
let last = 0;
const report = runFitCheck(n, {
  seed,
  zfight,
  onProgress: (i, total) => {
    const now = Date.now();
    if (now - last > 5000 || i === total) {
      last = now;
      process.stdout.write(`  ${i}/${total}\n`);
    }
  },
});
console.log(`checked ${report.combos} combinations in ${(report.ms / 1000).toFixed(1)} s (seed ${seed}; z-fight check on ${report.zfightCombos})`);
const groups = groupFailures(report.failures);
if (!groups.length) {
  console.log('PASS: no poke-through, no hair/glasses inside hats, no joint gaps over 20 mm, no coplanar overlaps');
  process.exit(0);
}
console.log(`FAIL: ${report.failures.length} failures in ${groups.length} groups\n`);
for (const g of groups) {
  console.log(`${g.item}  [${g.check}]  x${g.count}`);
  console.log(`    worst: ${g.example.detail}`);
  console.log(`    e.g.   ${g.example.combo}`);
  if (g.example.at) console.log(`    at     ${g.example.at}`);
}
process.exit(1);
