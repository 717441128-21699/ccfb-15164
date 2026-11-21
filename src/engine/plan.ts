/**
 * 出钓计划评分：把潮汐、昼夜、季节、风、气压、降雨、波浪合成
 * 鱼情活跃度与抛竿距离指数，并给出安全等级与解释。
 */
import type { FishingSpot, FishingWindow, WeatherSample } from '../types';
import { buildDayCache, type DayTideCache } from './tide';
import { weatherAt } from './weather';
import { tidalCurrentSpeed } from './extremes';

const HOUR = 3_600_000;
const ZONE = 8;

export interface HourScore {
  time: number;
  activity: number;
  casting: number;
  safety: FishingWindow['safety'];
  reasons: string[];
}

/** 简化日出日落（本地近似，纬度由钓点 y 映射到 18~40°N） */
function sunPhase(spot: FishingSpot, t: number): { isDay: boolean; dawnDusk: boolean; hour: number } {
  const local = new Date(t + ZONE * HOUR);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const month = local.getUTCMonth();
  const lat = 18 + spot.y * 22;
  const declination = -23.4 * Math.cos(((2 * Math.PI) / 365) * (10 + month * 30.4));
  const dayLen = (2 / 15) * (180 / Math.PI) * Math.acos(
    Math.min(1, Math.max(-1, -Math.tan((lat * Math.PI) / 180) * Math.tan((declination * Math.PI) / 180))),
  );
  const sunrise = 12 - dayLen / 2;
  const sunset = 12 + dayLen / 2;
  const dawnDusk = Math.abs(hour - sunrise) < 1.2 || Math.abs(hour - sunset) < 1.2;
  return { isDay: hour > sunrise && hour < sunset, dawnDusk, hour };
}

/** 抛竿距离指数 0~100：横风、阵风、波高越大越难抛 */
export function castingScore(spot: FishingSpot, w: WeatherSample): number {
  const crossAngle = Math.abs(Math.sin(((w.windDirection - spot.shoreOrientation) * Math.PI) / 180));
  const crossWind = w.windSpeed * crossAngle;
  let score = 100;
  score -= Math.min(45, crossWind * 6);
  score -= Math.min(25, Math.max(0, w.gust - w.windSpeed - 3) * 5);
  score -= Math.min(25, w.waveHeight * 12);
  if (w.rainfall > 8) score -= 8;
  return Math.round(clamp(score, 5, 100));
}

function safetyLevel(w: WeatherSample): FishingWindow['safety'] {
  if (w.windSpeed >= 13.8 || w.gust >= 17 || w.waveHeight >= 2.5 || w.rainfall >= 20) return 'danger';
  if (w.windSpeed >= 8 || w.waveHeight >= 1.2 || w.rainfall >= 8) return 'caution';
  return 'safe';
}

/** 单小时综合评分 */
export function scoreHour(spot: FishingSpot, cache: DayTideCache, t: number): HourScore {
  const w = weatherAt(spot, t);
  const reasons: string[] = [];
  const sun = sunPhase(spot, t);

  // 1) 潮汐流：流急鱼活跃（换流时刻略降），平潮最低
  const current = Math.abs(tidalCurrentSpeed(cache, t));
  const tidePart = clamp(0.25 + current * 2.2, 0, 1);
  if (current > 0.25) reasons.push('水流湍急，溶氧与饵鱼充足');

  // 2) 昼夜晨昏节律
  let lightPart = 0.55;
  if (sun.dawnDusk) {
    lightPart = 1;
    reasons.push('晨昏觅食高峰');
  } else if (sun.isDay) {
    lightPart = 0.5;
  } else {
    lightPart = 0.62;
  }

  // 3) 季节（春秋洄游季加成）
  const month = new Date(t + ZONE * HOUR).getUTCMonth();
  const seasonPart = month >= 2 && month <= 4 || month >= 8 && month <= 10 ? 1 : 0.82;

  // 4) 气压：稳定高气压或缓慢升压活跃；降压剧烈停口
  const wNext = weatherAt(spot, t + 3 * HOUR);
  const pressureTrend = wNext.pressure - w.pressure;
  let pressurePart = 0.8;
  if (w.pressure >= 1010 && pressureTrend >= -0.5) {
    pressurePart = 1;
    reasons.push('气压稳定偏高，咬口积极');
  } else if (pressureTrend < -2) {
    pressurePart = 0.35;
    reasons.push('气压快速走低，鱼群停口');
  } else if (w.pressure < 1005) {
    pressurePart = 0.55;
  }

  // 5) 风：3~5 级微风最佳，大风降权
  let windPart = 1;
  if (w.windSpeed < 1.5) {
    windPart = 0.72;
    reasons.push('风力过弱，水面缺少溶氧扰动');
  } else if (w.windSpeed <= 7.9) {
    windPart = 1;
  } else if (w.windSpeed <= 10.7) {
    windPart = 0.7;
    reasons.push('风力偏大，操作受限');
  } else {
    windPart = 0.4;
  }

  // 6) 降雨：小雨增氧利好，暴雨停口
  let rainPart = 1;
  if (w.rainfall > 0.1 && w.rainfall <= 2.5) {
    rainPart = 0.95;
    reasons.push('小雨搅水，近岸食物增加');
  } else if (w.rainfall > 2.5 && w.rainfall < 8) {
    rainPart = 0.75;
  } else if (w.rainfall >= 8) {
    rainPart = 0.35;
    reasons.push('强降雨影响视线与安全');
  }

  const activity = Math.round(
    clamp(
      100 *
        (0.3 * tidePart + 0.22 * lightPart + 0.1 * seasonPart + 0.16 * pressurePart +
          0.14 * windPart + 0.08 * rainPart),
      0,
      100,
    ),
  );

  return {
    time: t,
    activity,
    casting: castingScore(spot, w),
    safety: safetyLevel(w),
    reasons,
  };
}

/**
 * 评估一天，聚合为 3 小时出钓窗口并返回最优窗口。
 */
export function evaluateDay(spot: FishingSpot, localMidnightMs: number): FishingWindow[] {
  const cache = buildDayCache(localMidnightMs, ZONE, spot.constituents);
  const windows: FishingWindow[] = [];
  for (let startHour = 4; startHour <= 20; startHour += 3) {
    const start = localMidnightMs + startHour * HOUR;
    const hours: HourScore[] = [];
    for (let k = 0; k < 3; k++) {
      hours.push(scoreHour(spot, cache, start + k * HOUR));
    }
    const activityScore = Math.round(hours.reduce((s, h) => s + h.activity, 0) / hours.length);
    const castingScoreAvg = Math.round(hours.reduce((s, h) => s + h.casting, 0) / hours.length);
    const safety = hours.some((h) => h.safety === 'danger')
      ? 'danger'
      : hours.some((h) => h.safety === 'caution')
        ? 'caution'
        : 'safe';
    const reasonSet = new Set<string>();
    for (const h of hours) h.reasons.forEach((r) => reasonSet.add(r));
    windows.push({
      start,
      end: start + 3 * HOUR,
      activityScore,
      castingScore: castingScoreAvg,
      safety,
      reasons: [...reasonSet].slice(0, 4),
    });
  }
  return windows.sort((a, b) => b.activityScore - a.activityScore);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
