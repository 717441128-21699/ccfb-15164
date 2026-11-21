/**
 * 主线程 ↔ Web Worker 通信协议（结构化克隆，零依赖）。
 * 所有重计算都在 Worker 内完成，主线程只负责渲染。
 */
import type {
  FishingPlan,
  FishingSpot,
  FishingWindow,
  TideExtreme,
  TidePoint,
  WeatherSample,
} from '../types';

export const ZONE_HOURS = 8;

export type WorkerRequest =
  | { reqId: number; type: 'tideDay'; spotId: string; date: string; stepMinutes?: number }
  | {
      reqId: number;
      type: 'tideMonth';
      spotId: string;
      month: string; // YYYY-MM
      stepMinutes?: number;
    }
  | { reqId: number; type: 'tideMonthAll'; month: string; stepMinutes?: number }
  | { reqId: number; type: 'extremesDay'; spotId: string; date: string }
  | { reqId: number; type: 'extremesMonth'; spotId: string; month: string }
  | { reqId: number; type: 'weather'; spotId: string; date: string; days: number }
  | { reqId: number; type: 'planDay'; spotId: string; date: string }
  | { reqId: number; type: 'planCompare'; date: string }
  | { reqId: number; type: 'savePlan'; plan: FishingPlan };

export interface TideDayResult {
  spotId: string;
  date: string;
  series: TidePoint[];
  extremes: TideExtreme[];
}

export interface TideMonthResult {
  spotId: string;
  month: string;
  days: TideDayResult[];
}

export interface WeatherResult {
  spotId: string;
  samples: WeatherSample[];
}

export interface PlanDayResult {
  spotId: string;
  date: string;
  windows: FishingWindow[];
}

export type WorkerResponse =
  | { reqType: WorkerRequest['type']; reqId: number; error: string }
  | { reqType: 'tideDay'; reqId: number; data: TideDayResult }
  | { reqType: 'tideMonth' | 'tideMonthAll'; reqId: number; data: TideMonthResult[] }
  | { reqType: 'extremesDay'; reqId: number; data: TideExtreme[] }
  | { reqType: 'extremesMonth'; reqId: number; data: TideExtreme[] }
  | { reqType: 'weather'; reqId: number; data: WeatherResult }
  | { reqType: 'planDay'; reqId: number; data: PlanDayResult }
  | { reqType: 'planCompare'; reqId: number; data: PlanDayResult[] }
  | { reqType: 'savePlan'; reqId: number; data: FishingPlan };

export interface SpotSummary {
  spot: FishingSpot;
}
