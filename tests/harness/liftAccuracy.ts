// The same arc-length path and seat model used by the client/server, independently reported.
// pipeline/accuracy.py invokes this to keep ACCURACY.md reproducible.
import { readFileSync } from 'node:fs';
import { LiftPath } from '../../shared/lifts';

const resort = JSON.parse(readFileSync('client/public/world/resort.json', 'utf8'));
const lines = [
  '## Lift timing and geometry audit (November 17, 2026)', '',
  'Speeds and installed chair counts come from [Lift Blog\'s Sunlight inventory](https://liftblog.com/sunlight-co/), cross-checked against the [official replacement announcement](https://sunlightmtn.com/blog/lift-replacement-project/). These are published line speeds, not a measurement of a particular day\'s operating setting. Ride times below run from the load line to the unload line along the actual sagging cable.', '',
  '| Lift | Published speed ft/min | Chairs | Published ride min | Simulated ride | Headway s | Cable length ft (model / published) | Towers (OSM / published) |',
  '|---|---:|---:|---:|---|---:|---|---|',
];
for (const def of resort.lifts) {
  const p = new LiftPath(def), seconds = Math.round(p.rideTime());
  lines.push(`| ${def.name} | ${Math.round(def.speed * 60 / 0.3048)} | ${p.chairCount} | ${def.reference.rideMinutes} | ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} | ${(p.spacing / def.speed).toFixed(2)} | ${Math.round(p.lineLen / 0.3048).toLocaleString('en-US')} / ${def.reference.lengthFt.toLocaleString('en-US')} | ${def.supports.length - 2} / ${def.reference.towers} |`);
}
lines.push('', 'Published nominal capacities (Primo 1,800, Segundo 1,400, Tercero 1,200 people/hour) do not all reconcile with the published chair counts, lengths and speeds. The simulation preserves speed and chair count; headway follows loop length. Existing OSM alignments differ from published lengths by roughly 1 to 2.5 percent. Replacement tower coordinates are not surveyed, and old OSM tower counts are retained explicitly as a limitation.', '',
  'Rendering and ski contact share the winter station mesh at 0.5 m spacing. The target seat clearance at the stand line is 0.52 m. The contact table rolls from a 2.5 percent grade into a 16 percent exit. Rope gauge (5.2 m), hanger length (3 m), seat spacing (0.60 m), snow grooming and detector placement are model estimates. The terminal references show different loaded strands for Primo and Segundo. Tercero follows the older Riblet photo set. The detector triggers the existing comic missed-unload sequence. See DECISIONS.md D15 and the upper station reconstruction.', '');
console.log(lines.join('\n'));
