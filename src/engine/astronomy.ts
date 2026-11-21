/**
 * 天文幅角与交点因子（Schureman《Manual of Harmonic Analysis》体系）。
 *
 * 所有角度单位为度；时间基准为 UT（UTC 近似，游戏精度足够）。
 * 参考实现与快速引擎共用本模块的天文常数，但走不同的相位组装路径，
 * 便于在测试中交叉验证（见 engine/reference.ts）。
 */
import { norm360 } from './math';

/** 1900-01-01T00:00:00Z 纪元 */
export const EPOCH_1900_MS = Date.UTC(1900, 0, 1);
const MS_PER_DAY = 86_400_000;
const DAYS_PER_JULIAN_CENTURY = 36_525;

/** 分潮角速度，度/平均太阳时（Schureman 表 32） */
export const CONSTITUENT_SPEED: Record<string, number> = {
  M2: 28.9841042,
  S2: 30.0,
  N2: 28.4397295,
  K2: 30.0821373,
  K1: 15.0410686,
  O1: 13.9430356,
  P1: 14.9589314,
  Q1: 13.3986609,
};

export const CONSTITUENT_NAMES = ['M2', 'S2', 'N2', 'K2', 'K1', 'O1', 'P1', 'Q1'] as const;
export type ConstituentName = (typeof CONSTITUENT_NAMES)[number];

export interface Astronomy {
  /** 自 1900-01-01 起的天数（含小数，UT） */
  day: number;
  /** 儒略世纪数 T */
  century: number;
  /** 世界时小时 0~24 */
  utHour: number;
  /** 格林尼治平太阳时角 t = 15*UT 小时 */
  t: number;
  /** 月球平均经度 s */
  s: number;
  /** 太阳平均经度 h */
  h: number;
  /** 月球近地点平均经度 p */
  p: number;
  /** 月球升交点平均经度 N */
  N: number;
  /** 平均太阴时角 τ = t + h − s */
  tau: number;
}

/** 计算给定 UT 时刻的天文要素 */
export function computeAstronomy(msUt: number): Astronomy {
  const day = (msUt - EPOCH_1900_MS) / MS_PER_DAY;
  const T = day / DAYS_PER_JULIAN_CENTURY;
  const T2 = T * T;

  // Schureman 表 31：平均轨道要素（度/儒略世纪）
  const s = norm360(270.434164 + 481267.8831 * T - 0.001133 * T2);
  const h = norm360(279.69668 + 36000.76893 * T + 0.000303 * T2);
  const p = norm360(334.329556 + 4069.034 * T - 0.010325 * T2);
  const N = norm360(259.183275 - 1934.142 * T + 0.0021 * T2);

  const dayFrac = day - Math.floor(day);
  const utHour = dayFrac * 24;
  const t = norm360(15 * utHour);
  const tau = norm360(t + h - s);

  return { day, century: T, utHour, t, s, h, p, N, tau };
}

/**
 * 各分潮的格林尼治平衡潮初位相 V0（度），Schureman 平衡潮幅角公式：
 * M2=2τ  S2=2t  N2=2τ−s+p  K2=2t+2h
 * K1=τ+s−90  O1=τ−s+90  P1=t−h+90  Q1=τ−2s+p+90
 */
export function equilibriumArguments(a: Astronomy): Record<ConstituentName, number> {
  const { t, h, s, p, tau } = a;
  return {
    M2: norm360(2 * tau),
    S2: norm360(2 * t),
    N2: norm360(2 * tau - s + p),
    K2: norm360(2 * t + 2 * h),
    K1: norm360(tau + s - 90),
    O1: norm360(tau - s + 90),
    P1: norm360(t - h + 90),
    Q1: norm360(tau - 2 * s + p + 90),
  };
}

export interface NodeCorrection {
  /** 交点因子 f */
  f: number;
  /** 交点订正角 u，度 */
  u: number;
}

/**
 * 交点因子 f 与订正角 u（Schureman 表 14/15 的三角展开式）。
 * N 为升交点平均经度。
 */
export function nodeCorrections(a: Astronomy): Record<ConstituentName, NodeCorrection> {
  const N = a.N;
  const Nrad = (N * Math.PI) / 180;
  const c1 = Math.cos(Nrad);
  const c2 = Math.cos(2 * Nrad);
  const c3 = Math.cos(3 * Nrad);
  const s1 = Math.sin(Nrad);
  const s2 = Math.sin(2 * Nrad);
  const s3 = Math.sin(3 * Nrad);

  const fM2 = 1.0004 - 0.0373 * c1 + 0.0002 * c2;
  const uM2 = -2.14 * s1;

  const fK2 = 1.0241 + 0.2863 * c1 + 0.0084 * c2 - 0.0015 * c3;
  const uK2 = -17.74 * s1 + 0.73 * s2 - 0.09 * s3;

  const fK1 = 1.006 + 0.115 * c1 - 0.0088 * c2 + 0.0006 * c3;
  const uK1 = -8.86 * s1 + 0.48 * s2 - 0.06 * s3;

  const fO1 = 1.0089 + 0.2891 * c1 - 0.0203 * c2 + 0.0007 * c3;
  const uO1 = 10.8 * s1 - 0.68 * s2 + 0.05 * s3;

  return {
    M2: { f: fM2, u: uM2 },
    S2: { f: 1, u: 0 },
    N2: { f: fM2, u: uM2 },
    K2: { f: fK2, u: uK2 },
    K1: { f: fK1, u: uK1 },
    O1: { f: fO1, u: uO1 },
    P1: { f: 1, u: 0 },
    Q1: { f: fO1, u: uO1 },
  };
}
