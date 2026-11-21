/**
 * 高/低潮提取：10 分钟粗扫定位导数变号，再用解析导数二分精化时刻。
 * 气象增水来自预计算的整点增水表（线性插值），与潮位序列共用。
 */
import type { FishingSpot, TideExtreme } from '../types';
import { buildDayCache, predictAstronomical, type DayTideCache } from './tide';
import { buildSurgeTable, surgeFromTable } from './weather';
import { CONSTITUENT_NAMES } from './astronomy';

const HOUR = 3_600_000;
const SCAN_STEP = 10 * 60_000;

/** 天文潮解析导数（米/毫秒） */
function astronomicalDerivative(cache: DayTideCache, t: number): number {
  const dt = t - cache.anchorMs;
  let d = 0;
  for (const name of CONSTITUENT_NAMES) {
    const c = cache.constituents.get(name);
    if (!c) continue;
    const theta = c.phaseBase + c.speedRadPerMs * dt;
    d -= c.amp * Math.sin(theta) * c.speedRadPerMs;
  }
  return d;
}

/** 增水表线性导数（米/毫秒，分段常数） */
function surgeDerivative(table: Float64Array, dayStartMs: number, t: number): number {
  const idx = (t - (dayStartMs - HOUR)) / HOUR;
  const i = Math.floor(idx);
  if (i < 0 || i >= table.length - 1) return 0;
  return (table[i + 1] - table[i]) / HOUR;
}

/**
 * 提取本地日历日内的全部高低潮。
 * 扫描区间前后各留 2 小时，避免漏掉贴近日界的极值。
 */
export function findExtremes(
  spot: FishingSpot,
  localMidnightMs: number,
  zoneHours: number,
  surgeTable?: Float64Array,
): TideExtreme[] {
  const cache = buildDayCache(localMidnightMs, zoneHours, spot.constituents);
  const table = surgeTable ?? buildDefaultTable(spot, localMidnightMs);
  const totalDerivative = (t: number) =>
    astronomicalDerivative(cache, t) + surgeDerivative(table, localMidnightMs, t);

  const start = localMidnightMs - 2 * HOUR;
  const end = localMidnightMs + 24 * HOUR + 2 * HOUR;

  const extremes: TideExtreme[] = [];
  let prevT = start;
  let prevD = totalDerivative(prevT);

  for (let t = start + SCAN_STEP; t <= end; t += SCAN_STEP) {
    const d = totalDerivative(t);
    if (prevD === 0 || prevD * d < 0) {
      const root = bisectDerivative(totalDerivative, prevT, t);
      // 只保留落在当日 [00:00, 24:00) 内的极值
      if (root >= localMidnightMs && root < localMidnightMs + 24 * HOUR) {
        const height =
          spot.meanLevel +
          predictAstronomical(cache, root) +
          surgeFromTable(table, localMidnightMs, root);
        extremes.push({
          time: Math.round(root / 1000) * 1000,
          height: Math.round(height * 1000) / 1000,
          kind: prevD > 0 ? 'high' : 'low',
        });
      }
    }
    prevT = t;
    prevD = d;
  }
  return extremes;
}

function buildDefaultTable(spot: FishingSpot, dayStartMs: number): Float64Array {
  return buildSurgeTable(spot, dayStartMs);
}

/** 导数零点二分，收敛到毫秒级 */
function bisectDerivative(derivative: (t: number) => number, lo: number, hi: number): number {
  let fLo = derivative(lo);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const fMid = derivative(mid);
    if (fMid === 0 || hi - lo < 1) return mid;
    if (fLo * fMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** 某时刻潮位升降流速代理（米/小时，正=涨潮），用于鱼情评分 */
export function tidalCurrentSpeed(cache: DayTideCache, t: number): number {
  return astronomicalDerivative(cache, t) * HOUR;
}
