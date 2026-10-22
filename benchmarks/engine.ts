import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { createSalesEngine } from '../apps/shared/sales';
import { parseAddress } from '../packages/core/src/index';

const scenarios = [];
for (const rows of [100000, 1000000]) {
  const start = performance.now();
  const engine = createSalesEngine(rows);
  const createdMs = performance.now() - start;
  const first = performance.now();
  engine.block({ start: { row: 0, col: 0 }, end: { row: 63, col: 15 } }, 0);
  const firstBlockMs = performance.now() - first;
  engine.apply({ cells: [{ row: 0, col: 8, input: `=SUM(D1:D${rows})` }] });
  const sumStart = performance.now();
  const total = engine.value(parseAddress('I1')!);
  const aggregateMs = performance.now() - sumStart;
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const before = performance.now();
    engine.apply({ cells: [{ row: 0, col: 3, input: i + 1 }] });
    engine.value(parseAddress('G1')!);
    samples.push(performance.now() - before);
  }
  samples.sort((a, b) => a - b);
  scenarios.push({
    rows,
    columns: 50,
    generatedSourceColumns: 6,
    calculatedColumns: 2,
    createdMs,
    firstBlockMs,
    aggregateMs,
    total,
    editAndCalculateP95Ms: samples[Math.floor(samples.length * 0.95)],
    stats: engine.stats,
  });
}
const result = {
  timestamp: new Date().toISOString(),
  runtime: process.version,
  system: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  heapUsedMiB: process.memoryUsage().heapUsed / 1048576,
  note: 'Generated source values; startup does not materialize the full dataset. Aggregate measures one million numeric source cells, not one million dependent formulas.',
  scenarios,
};
await mkdir('benchmark-results', { recursive: true });
await writeFile('benchmark-results/engine.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
