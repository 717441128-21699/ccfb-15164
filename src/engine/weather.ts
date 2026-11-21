/**
 * 确定性天气引擎：由"世界时间 + 钓点种子"生成可复现的天气序列。
 * 低气压通过逆气压效应抬升潮位（−9.9 mm/hPa 偏差），
 * 向岸风产生风增水；风浪影响抛竿与鱼情（见 plan.ts）。
 */
import type { FishingSpot, WeatherKind, WeatherSample } from '../types';
import { gaussian, mulberry32 } from './math';

export const WEATHER_STEP_HOURS = 3;
const STEP_MS = WEATHER_STEP_HOURS * 3_600_000;
/** 逆气压效应：每偏离标准气压 1 hPa 的静水位修正（米），低压抬升、高压压低 */
export const INVERSE_BAROMETER_M_PER_HPA = 0.0099;
const STANDARD_PRESSURE = 1013.25;
/** 风增水系数（与向岸风分量、水深组合后使用） */
const WIND_SETUP_COEF = 0.0016;

const DAY_MS = 86_400_000;

/** 把任意时刻对齐到 3 小时网格 */
export function weatherGridStart(timeMs: number): number {
  return Math.floor(timeMs / STEP_MS) * STEP_MS;
}

/** 低频正弦叠加，构成移动的天气尺度系统 */
function field(seed: number, timeMs: number, periodHours: number, phase: number): number {
  return Math.sin((2 * Math.PI * timeMs) / (periodHours * 3_600_000) + seed * 0.731 + phase);
}

/** 单格天气（区域大尺度场 × 钓点局地调制） */
export function sampleWeather(spot: FishingSpot, timeMs: number): WeatherSample {
  const grid = weatherGridStart(timeMs);
  const rand = mulberry32(spot.weatherSeed ^ Math.floor(grid / STEP_MS));
  const seed = spot.weatherSeed;

  // —— 气压：3~5 天移动的高压/低压系统，振幅约 ±12 hPa ——
  const pressureWave =
    8.5 * field(seed, grid, 84, 0) + 4.5 * field(seed, grid, 56, 2.1) + 2 * field(seed, grid, 31, 4.2);
  const pressure = STANDARD_PRESSURE + pressureWave;

  // —— 风：地转风随低压旋转，叠加日变化 ——
  const pressureGradient =
    (8.5 * 2 * Math.PI) / (84 * 3_600_000) * Math.cos((2 * Math.PI * grid) / (84 * 3_600_000) + seed * 0.731);
  const baseDirection = norm360deg(180 + seed * 47 + 25 * field(seed, grid, 60, 1.3));
  const cyclonicTurn = -Math.sign(pressureGradient) * 35 * Math.min(1, Math.abs(pressureGradient) * 2e7);
  const windDirection = norm360deg(baseDirection + cyclonicTurn);

  const lowPressureBoost = Math.max(0, STANDARD_PRESSURE - pressure) * 0.55;
  const diurnal = 1.2 * Math.sin((2 * Math.PI * (grid % DAY_MS)) / DAY_MS + 1.2);
  const windSpeed = Math.max(
    0.3,
    2.2 + lowPressureBoost + 2.4 * Math.abs(field(seed, grid, 48, 0.5)) + diurnal + gaussian(rand) * 0.8,
  );
  const gust = windSpeed * (1.25 + 0.25 * Math.abs(field(seed, grid, 12, seed)));

  // —— 降雨：湿润锋面过境，低气压+高湿触发 ——
  const moisture = field(seed, grid, 40, 3.7);
  const rainPotential = moisture * 0.5 + (STANDARD_PRESSURE - pressure) / 22;
  let rainfall = 0;
  if (rainPotential > 0.32) {
    rainfall = Math.max(0, (rainPotential - 0.32) * 14 * (0.6 + rand() * 0.8));
  }
  // 偶发强对流
  if (rand() < 0.035 && pressure < 1008) {
    rainfall = Math.max(rainfall, 18 + rand() * 22);
  }

  const cloud = clamp01(0.45 + 0.35 * moisture + (STANDARD_PRESSURE - pressure) / 40 + (rainfall > 0 ? 0.2 : 0));
  const kind = classify(cloud, rainfall);

  // —— 风浪：SMB 式简化成长，浅水钓点波高受限 ——
  const fetchKm = 18 + 26 * ((seed * 13) % 10) / 10;
  const deepWave = 0.09 * Math.sqrt(fetchKm) * windSpeed * Math.pow(windSpeed, 0.35) / 4;
  const waveHeight = Math.min(deepWave, spot.depth * 0.55);
  const wavePeriod = 2.2 + 0.82 * Math.sqrt(Math.max(waveHeight, 0.01) * 9.81 / 1.57);

  return {
    time: grid,
    pressure,
    windSpeed,
    gust,
    windDirection,
    rainfall,
    cloud,
    waveHeight,
    wavePeriod,
    kind,
  };
}

/** 线性插值取任意时刻天气（用于逐小时潮位增水与鱼情） */
export function weatherAt(spot: FishingSpot, timeMs: number): WeatherSample {
  const g0 = weatherGridStart(timeMs);
  const a = sampleWeather(spot, g0);
  const b = sampleWeather(spot, g0 + STEP_MS);
  const r = (timeMs - g0) / STEP_MS;
  const lerp = (x: number, y: number) => x + (y - x) * r;
  // 风向走最短弧
  let dd = b.windDirection - a.windDirection;
  if (dd > 180) dd -= 360;
  if (dd < -180) dd += 360;
  return {
    time: timeMs,
    pressure: lerp(a.pressure, b.pressure),
    windSpeed: lerp(a.windSpeed, b.windSpeed),
    gust: lerp(a.gust, b.gust),
    windDirection: norm360deg(a.windDirection + dd * r),
    rainfall: lerp(a.rainfall, b.rainfall),
    cloud: lerp(a.cloud, b.cloud),
    waveHeight: lerp(a.waveHeight, b.waveHeight),
    wavePeriod: lerp(a.wavePeriod, b.wavePeriod),
    kind: r < 0.5 ? a.kind : b.kind,
  };
}

/** 气象增水（米）：逆气压效应 + 向岸风增水 */
export function meteorologicalSurge(spot: FishingSpot, timeMs: number): number {
  const w = weatherAt(spot, timeMs);
  // 逆气压效应：P 每低于标准 1 hPa，水位抬升约 9.9 mm
  const ib = (STANDARD_PRESSURE - w.pressure) * INVERSE_BAROMETER_M_PER_HPA;
  // 向岸分量：风向（来向）与岸线法线一致时最大
  const onshore = Math.cos(((w.windDirection - spot.shoreOrientation) * Math.PI) / 180);
  const windSetup = WIND_SETUP_COEF * (w.windSpeed * w.windSpeed / Math.max(spot.depth, 2)) * Math.max(onshore, 0);
  return ib + windSetup;
}

/** 生成天数范围的 3 小时天气序列 */
export function buildWeatherForecast(spot: FishingSpot, startMs: number, days: number): WeatherSample[] {
  const g0 = weatherGridStart(startMs);
  const count = Math.ceil((days * DAY_MS) / STEP_MS) + 1;
  const out: WeatherSample[] = [];
  for (let i = 0; i < count; i++) {
    out.push(sampleWeather(spot, g0 + i * STEP_MS));
  }
  return out;
}

const HOUR_MS = 3_600_000;

/**
 * 预计算一天（含前后各 1 小时余量）的整点气象增水表，
 * 潮位序列与极值提取共用；表内线性插值，避免逐点重算天气场。
 */
export function buildSurgeTable(spot: FishingSpot, dayStartMs: number): Float64Array {
  const table = new Float64Array(26); // -1h .. 25h 共 26 个整点
  for (let i = 0; i < table.length; i++) {
    table[i] = meteorologicalSurge(spot, dayStartMs + (i - 1) * HOUR_MS);
  }
  return table;
}

/** 整点增水表上线性插值（t 需落在表覆盖区间内） */
export function surgeFromTable(table: Float64Array, dayStartMs: number, t: number): number {
  const idx = (t - (dayStartMs - HOUR_MS)) / HOUR_MS;
  const i = Math.floor(idx);
  const r = idx - i;
  if (i < 0) return table[0];
  if (i >= table.length - 1) return table[table.length - 1];
  return table[i] + (table[i + 1] - table[i]) * r;
}

function classify(cloud: number, rain: number): WeatherKind {
  if (rain >= 20) return 'thunderstorm';
  if (rain >= 8) return 'heavy_rain';
  if (rain >= 2.5) return 'rain';
  if (rain > 0.1) return 'drizzle';
  if (cloud >= 0.85) return 'overcast';
  if (cloud >= 0.6) return 'cloudy';
  if (cloud >= 0.3) return 'partly_cloudy';
  return 'clear';
}

function norm360deg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
