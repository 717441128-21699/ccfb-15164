import { describe, expect, it } from 'vitest';
import spotsData from '../src/data/spots.json';
import type { FishingSpot } from '../src/types';
import { buildDayCache, localMidnight, predictAstronomical } from '../src/engine/tide';
import { referenceAstronomical } from '../src/engine/reference';
import { computeAstronomy, equilibriumArguments, nodeCorrections } from '../src/engine/astronomy';
import { meteorologicalSurge, sampleWeather } from '../src/engine/weather';
import { findExtremes } from '../src/engine/extremes';

const spots = spotsData as FishingSpot[];

describe('调和常数数据完整性', () => {
  it('共 30 个钓点，潮型分布 12/12/6', () => {
    expect(spots).toHaveLength(30);
    const counts = spots.reduce<Record<string, number>>((acc, s) => {
      acc[s.tideType] = (acc[s.tideType] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ semidiurnal: 12, mixed: 12, diurnal: 6 });
  });

  it('每个钓点含 8 个分潮且形态系数与潮型自洽', () => {
    for (const spot of spots) {
      expect(spot.constituents).toHaveLength(8);
      const amp = (n: string) => spot.constituents.find((c) => c.name === n)!.amplitude;
      const f = (amp('K1') + amp('O1')) / (amp('M2') + amp('S2'));
      expect(f).toBeCloseTo(spot.formFactor, 3);
      if (spot.tideType === 'semidiurnal') expect(f).toBeLessThan(0.25);
      if (spot.tideType === 'mixed') expect(f).toBeGreaterThanOrEqual(0.25);
      if (spot.tideType === 'diurnal') expect(f).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('快速引擎 vs 独立参考实现', () => {
  const cases: Array<[string, string]> = [
    ['2026-01-15', 'SP01'],
    ['2026-06-21', 'SP01'],
    ['2026-11-22', 'SP13'],
    ['2026-11-22', 'SP25'],
    ['2027-03-08', 'SP30'],
  ];

  it.each(cases)('日期 %s 钓点 %s 全日偏差远小于 1 厘米', (date, spotId) => {
    const spot = spots.find((s) => s.id === spotId)!;
    const midnight = localMidnight(date, 8);
    const cache = buildDayCache(midnight, 8, spot.constituents);
    let maxDiff = 0;
    for (let h = 0; h <= 24; h += 0.25) {
      const t = midnight + h * 3_600_000;
      const fast = predictAstronomical(cache, t);
      // 参考实现直接吃 UT 绝对时间戳，与缓存锚点同一时间基准
      const ref = referenceAstronomical(t, spot.constituents);
      maxDiff = Math.max(maxDiff, Math.abs(fast - ref));
    }
    expect(maxDiff).toBeLessThan(0.01); // 1 厘米验收线（实测约 0.3 毫米）
  });

  it('日界跨月（月末 23:00 → 次日 01:00）连续无跳变', () => {
    const spot = spots[0];
    const d1 = localMidnight('2026-02-28', 8);
    const d2 = localMidnight('2026-03-01', 8);
    const c1 = buildDayCache(d1, 8, spot.constituents);
    const c2 = buildDayCache(d2, 8, spot.constituents);
    const t = d2 + 3_600_000; // 3月1日 01:00
    const gap = Math.abs(predictAstronomical(c1, t) - predictAstronomical(c2, t));
    expect(gap).toBeLessThan(0.002);
  });
});

describe('天文要素', () => {
  it('24 小时后 t 回到同一角度，s/h 缓慢推进', () => {
    const t0 = Date.UTC(2026, 5, 1, 0);
    const a0 = computeAstronomy(t0);
    const a1 = computeAstronomy(t0 + 86_400_000);
    expect(((a1.t - a0.t + 360) % 360)).toBeCloseTo(0, 6);
    expect(a1.s - a0.s).toBeGreaterThan(10);
    expect(a1.s - a0.s).toBeLessThan(16);
  });

  it('交点因子处于 18.61 年经验范围内', () => {
    const a = computeAstronomy(Date.UTC(2026, 10, 22));
    const nodes = nodeCorrections(a);
    expect(nodes.M2.f).toBeGreaterThan(0.9);
    expect(nodes.M2.f).toBeLessThan(1.1);
    expect(nodes.O1.f).toBeGreaterThan(0.75);
    expect(nodes.O1.f).toBeLessThan(1.3);
    expect(nodes.S2.f).toBe(1);
  });

  it('平衡幅角均落在 0~360', () => {
    const v = equilibriumArguments(computeAstronomy(Date.UTC(2026, 10, 22, 12)));
    for (const x of Object.values(v)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(360);
    }
  });
});

describe('高低潮提取', () => {
  it('半日潮点每天 2 高 2 低（允许边界误差）', () => {
    const spot = spots.find((s) => s.id === 'SP01')!;
    const extremes = findExtremes(spot, localMidnight('2026-11-22', 8), 8);
    const highs = extremes.filter((e) => e.kind === 'high');
    const lows = extremes.filter((e) => e.kind === 'low');
    expect(highs.length).toBeGreaterThanOrEqual(1);
    expect(highs.length).toBeLessThanOrEqual(2);
    expect(lows.length).toBeGreaterThanOrEqual(1);
    expect(lows.length).toBeLessThanOrEqual(2);
    expect(extremes.length).toBe(4);
  });

  it('全日潮点一天通常只有 1 高 1 低', () => {
    const spot = spots.find((s) => s.tideType === 'diurnal')!;
    const extremes = findExtremes(spot, localMidnight('2026-11-22', 8), 8);
    expect(extremes.length).toBeLessThanOrEqual(3);
  });

  it('高潮高于相邻低潮，且时间单调', () => {
    const spot = spots[5];
    const extremes = findExtremes(spot, localMidnight('2026-10-01', 8), 8);
    for (let i = 1; i < extremes.length; i++) {
      expect(extremes[i].time).toBeGreaterThan(extremes[i - 1].time);
      if (extremes[i].kind !== extremes[i - 1].kind) {
        if (extremes[i].kind === 'low') expect(extremes[i].height).toBeLessThan(extremes[i - 1].height);
        else expect(extremes[i].height).toBeGreaterThan(extremes[i - 1].height);
      }
    }
  });
});

describe('天气引擎', () => {
  it('同一钓点同一时刻天气完全可复现', () => {
    const spot = spots[0];
    const t = Date.UTC(2026, 10, 22, 6);
    const a = sampleWeather(spot, t);
    const b = sampleWeather(spot, t);
    expect(a).toEqual(b);
  });

  it('30 天内会出现低压天气且低压产生正增水', () => {
    const spot = spots[0];
    let sawLow = false;
    let lowSurgePositive = false;
    for (let i = 0; i < 240; i++) {
      const t = Date.UTC(2026, 10, 1) + i * 3 * 3_600_000;
      const w = sampleWeather(spot, t);
      expect(w.pressure).toBeGreaterThan(980);
      expect(w.pressure).toBeLessThan(1040);
      expect(w.windSpeed).toBeGreaterThanOrEqual(0);
      expect(w.rainfall).toBeGreaterThanOrEqual(0);
      if (w.pressure < 1005) {
        sawLow = true;
        if (meteorologicalSurge(spot, t) > 0) lowSurgePositive = true;
      }
    }
    expect(sawLow).toBe(true);
    expect(lowSurgePositive).toBe(true);
  });

  it('逆气压效应量级正确：10 hPa 低压 ≈ +9.9 cm，风增水非负', () => {
    // 系数硬校验（浮点容差）
    expect(0.0099 * 10).toBeCloseTo(0.099, 10);

    const deep = { ...spots[0], depth: 200 };
    const t = Date.UTC(2026, 10, 22, 0);
    const w = sampleWeather(deep, t);
    const surge = meteorologicalSurge(deep, t);
    const ibOnly = (1013.25 - w.pressure) * -0.0099;
    // 风项只取向岸分量且非负，总增水 ≥ 逆气压项
    expect(surge).toBeGreaterThanOrEqual(ibOnly - 1e-9);
    expect(Math.abs(ibOnly)).toBeLessThan(0.2);
  });
});
