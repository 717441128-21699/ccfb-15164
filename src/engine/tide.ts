/**
 * 快速潮汐引擎：以"本地日锚点 + 角速度外推"代替逐时刻天文计算。
 *
 * 相位公式（区时调和常数约定）：
 *   θ_c(t) = V_c(t0) + σ_c·(t−t0) + u_c(t0) − g_c
 *   h(t)   = Z0 + Σ f_c·H_c·cos θ_c
 *
 * 其中 f/u 在锚点（本地零点）冻结，18.61 年交点变化在一天内的
 * 相位漂移小于 0.001°，对应高度误差亚毫米级（见 tests/tide.test.ts）。
 */
import type { Constituent, TidePoint } from '../types';
import {
  CONSTITUENT_NAMES,
  CONSTITUENT_SPEED,
  type ConstituentName,
  computeAstronomy,
  equilibriumArguments,
  nodeCorrections,
} from './astronomy';
import { DEG, norm360 } from './math';
import { surgeFromTable } from './weather';

const MS_PER_HOUR = 3_600_000;
const SPEED_RAD_PER_MS_FACTOR = DEG / MS_PER_HOUR;

interface ConstituentCache {
  f: number;
  /** 锚点处相位基准（弧度）：V0 + u − g */
  phaseBase: number;
  /** 角速度（弧度/毫秒） */
  speedRadPerMs: number;
  /** f·H 合并后的系数（米） */
  amp: number;
}

export interface DayTideCache {
  /** 锚点绝对时间（本地零点对应的 UT 时刻） */
  anchorMs: number;
  zoneHours: number;
  constituents: Map<ConstituentName, ConstituentCache>;
}

/**
 * 建立本地日缓存。
 * @param localMidnightMs 本地零点的绝对时间戳
 * @param zoneHours 时区（东八区 = 8）
 * @param spotConstituents 钓点调和常数
 */
export function buildDayCache(
  localMidnightMs: number,
  zoneHours: number,
  spotConstituents: Constituent[],
): DayTideCache {
  const anchorMs = localMidnightMs - zoneHours * MS_PER_HOUR;
  const astro = computeAstronomy(anchorMs);
  const v0 = equilibriumArguments(astro);
  const nodes = nodeCorrections(astro);

  const map = new Map<ConstituentName, ConstituentCache>();
  for (const c of spotConstituents) {
    const name = c.name as ConstituentName;
    const node = nodes[name];
    const speedDegPerHour = CONSTITUENT_SPEED[name];
    map.set(name, {
      f: node.f,
      phaseBase: (norm360(v0[name] + node.u - c.phaseLag)) * DEG,
      speedRadPerMs: speedDegPerHour * SPEED_RAD_PER_MS_FACTOR,
      amp: node.f * c.amplitude,
    });
  }

  return { anchorMs, zoneHours, constituents: map };
}

/** 纯天文潮高（米，相对海图基准；不含平均海平面以外的气象项） */
export function predictAstronomical(cache: DayTideCache, timeMs: number): number {
  const dt = timeMs - cache.anchorMs;
  let h = 0;
  for (const name of CONSTITUENT_NAMES) {
    const c = cache.constituents.get(name);
    if (!c) continue;
    h += c.amp * Math.cos(c.phaseBase + c.speedRadPerMs * dt);
  }
  return h;
}

/** 本地零点时间戳（东八区日历日） */
export function localMidnight(dateISO: string, zoneHours = 8): number {
  // dateISO 形如 2026-11-22，按区时解释为该日 00:00
  const [y, m, d] = dateISO.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - zoneHours * MS_PER_HOUR;
}

export function addDays(dateISO: string, days: number): string {
  const ms = localMidnight(dateISO) + days * 86_400_000;
  return toISODate(ms + 8 * MS_PER_HOUR);
}

export function toISODate(msUt: number, zoneHours = 8): string {
  const d = new Date(msUt + zoneHours * MS_PER_HOUR);
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 生成一天的等间隔潮位序列（含气象增水） */
export function buildTideSeries(
  cache: DayTideCache,
  meanLevel: number,
  dayStartMs: number,
  stepMinutes: number,
  surgeTable: Float64Array,
): TidePoint[] {
  const step = stepMinutes * 60_000;
  const points: TidePoint[] = [];
  // 多取前后各 1 小时，方便曲线绘制与极值判定
  const start = dayStartMs - MS_PER_HOUR;
  const end = dayStartMs + 24 * MS_PER_HOUR + MS_PER_HOUR;
  for (let t = start; t <= end + 0.5; t += step) {
    const astro = meanLevel + predictAstronomical(cache, t);
    const surge = surgeFromTable(surgeTable, dayStartMs, t);
    points.push({ time: t, height: astro + surge, astronomical: astro, surge });
  }
  return points;
}
