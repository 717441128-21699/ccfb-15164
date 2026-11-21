/**
 * 领域核心类型定义
 */

/** 分潮调和常数（单个钓点的单个分潮） */
export interface Constituent {
  /** 分潮代号：M2 S2 N2 K2 K1 O1 P1 Q1 */
  name: string;
  /** 振幅 H，单位米 */
  amplitude: number;
  /** 区时迟角 g（东八区相位基准），单位度 */
  phaseLag: number;
}

/** 潮型 */
export type TideType = 'semidiurnal' | 'mixed' | 'diurnal';

/** 钓点 */
export interface FishingSpot {
  id: string;
  name: string;
  /** 虚构海域内的归一化坐标（0~1，用于 SVG 地图） */
  x: number;
  y: number;
  /** 海岸线朝向（风的岸向分量基准），度，0=北 */
  shoreOrientation: number;
  /** 基准水深，米 */
  depth: number;
  /** 平均海平面（相对海图基准），米 */
  meanLevel: number;
  /** 天气随机种子 */
  weatherSeed: number;
  /** 调和常数，8 个分潮 */
  constituents: Constituent[];
  /** 形态系数 F=(H_K1+H_O1)/(H_M2+H_S2)，由常数派生，存档便于校验 */
  formFactor: number;
  tideType: TideType;
}

/** 天气现象分级 */
export type WeatherKind =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'overcast'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'thunderstorm';

/** 单时次天气（3 小时一格） */
export interface WeatherSample {
  time: number;
  /** 海平面气压 hPa */
  pressure: number;
  /** 10m 风速 m/s */
  windSpeed: number;
  /** 阵风 m/s */
  gust: number;
  /** 风向（来向），度，0=北，顺时针 */
  windDirection: number;
  /** 降雨量 mm/h */
  rainfall: number;
  /** 云量 0~1 */
  cloud: number;
  /** 有效波高 米 */
  waveHeight: number;
  /** 波浪周期 秒 */
  wavePeriod: number;
  kind: WeatherKind;
}

/** 天文潮（不含气象增水）单点时刻 */
export interface TidePoint {
  time: number;
  /** 总潮高（含气象增水），米，相对海图基准 */
  height: number;
  /** 纯天文潮高，米 */
  astronomical: number;
  /** 气象增水（逆气压 + 风增水），米 */
  surge: number;
}

/** 高/低潮 */
export interface TideExtreme {
  time: number;
  height: number;
  kind: 'high' | 'low';
}

/** 出钓时段评分 */
export interface FishingWindow {
  start: number;
  end: number;
  /** 综合鱼情 0~100 */
  activityScore: number;
  /** 抛竿距离指数 0~100 */
  castingScore: number;
  /** 安全等级 */
  safety: 'safe' | 'caution' | 'danger';
  reasons: string[];
}

/** 出钓计划 */
export interface FishingPlan {
  id: string;
  spotId: string;
  date: string;
  createdAt: number;
  note: string;
}
