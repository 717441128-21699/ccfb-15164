/**
 * 性能基准：30 个钓点 × 整月（30 天）× 10 分钟潮位 + 高低潮提取。
 * 验收线：总耗时 < 500ms（Node 端直接调用引擎，与 Worker 同一份代码）。
 */
import spotsData from '../src/data/spots.json';
import type { FishingSpot } from '../src/types';
import { buildDayCache, buildTideSeries, localMidnight } from '../src/engine/tide';
import { findExtremes } from '../src/engine/extremes';
import { buildSurgeTable } from '../src/engine/weather';

const spots = spotsData as FishingSpot[];
const MONTH = '2026-11';

function runOnce(): number {
  const t0 = performance.now();
  let pointCount = 0;
  let extremeCount = 0;
  for (const spot of spots) {
    for (let day = 1; day <= 30; day++) {
      const date = `${MONTH}-${String(day).padStart(2, '0')}`;
      const midnight = localMidnight(date, 8);
      const cache = buildDayCache(midnight, 8, spot.constituents);
      const surgeTable = buildSurgeTable(spot, midnight);
      const series = buildTideSeries(cache, spot.meanLevel, midnight, 10, surgeTable);
      pointCount += series.length;
      extremeCount += findExtremes(spot, midnight, 8, surgeTable).length;
    }
  }
  const elapsed = performance.now() - t0;
  console.log(`潮位点: ${pointCount}，高低潮: ${extremeCount}`);
  return elapsed;
}

// 预热（JIT）
runOnce();

const runs = 5;
const timings: number[] = [];
for (let i = 0; i < runs; i++) timings.push(runOnce());
const avg = timings.reduce((a, b) => a + b, 0) / runs;
const min = Math.min(...timings);
const max = Math.max(...timings);

console.log(`30 钓点 × 30 天潮汐计算（${runs} 次）`);
console.log(`平均 ${avg.toFixed(1)}ms | 最快 ${min.toFixed(1)}ms | 最慢 ${max.toFixed(1)}ms`);
if (avg >= 500) {
  console.error('❌ 未达到 500ms 验收线');
  process.exit(1);
}
console.log('✅ 满足 < 500ms 验收线');
