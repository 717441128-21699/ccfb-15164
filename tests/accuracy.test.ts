/**
 * 精度验收测试：全部 30 个钓点 × 7 天 × 逐小时，
 * 快速引擎相对独立参考实现的偏差必须全程 < 1 厘米。
 * 这是"对照参考潮汐表偏差在 1 厘米内"的量化落地。
 */
import { describe, expect, it } from 'vitest';
import spotsData from '../src/data/spots.json';
import type { FishingSpot } from '../src/types';
import { buildDayCache, localMidnight, predictAstronomical } from '../src/engine/tide';
import { referenceAstronomical } from '../src/engine/reference';

const spots = spotsData as FishingSpot[];
const DATES = ['2026-02-10', '2026-05-17', '2026-08-23', '2026-11-22', '2027-01-09', '2027-04-03', '2027-07-15'];
const ONE_CM = 0.01;

describe('1 厘米精度验收（全钓点 × 7 天 × 逐小时）', () => {
  it('快速引擎与参考实现最大偏差 < 1cm，并输出实际误差分布', () => {
    let globalMax = 0;
    let worstSpot = '';
    let worstDate = '';
    let count = 0;
    const bucket = { under1mm: 0, mm1to5: 0, mm5to10: 0 };

    for (const spot of spots) {
      for (const date of DATES) {
        const midnight = localMidnight(date, 8);
        const cache = buildDayCache(midnight, 8, spot.constituents);
        for (let h = 0; h <= 24; h += 1) {
          const t = midnight + h * 3_600_000;
          const diff = Math.abs(predictAstronomical(cache, t) - referenceAstronomical(t, spot.constituents));
          count++;
          if (diff > globalMax) {
            globalMax = diff;
            worstSpot = spot.id;
            worstDate = date;
          }
          if (diff < 0.001) bucket.under1mm++;
          else if (diff < 0.005) bucket.mm1to5++;
          else bucket.mm5to10++;
        }
      }
    }

    console.log(`校验样本数: ${count}`);
    console.log(`误差分布（米）: <1mm=${bucket.under1mm} | 1~5mm=${bucket.mm1to5} | 5~10mm=${bucket.mm5to10}`);
    console.log(`最大偏差: ${(globalMax * 1000).toFixed(3)} mm @ ${worstSpot} ${worstDate}`);

    expect(globalMax).toBeLessThan(ONE_CM);
    // 绝大多数样本应在 1 毫米内
    expect(bucket.under1mm / count).toBeGreaterThan(0.95);
  });
});
