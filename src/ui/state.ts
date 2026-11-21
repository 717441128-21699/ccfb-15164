import type { FishingPlan, FishingSpot, TideType, WeatherKind } from '../types';
import spotsData from '../data/spots.json';
import { todayISO } from './dom';

export const spots = spotsData as FishingSpot[];
export const spotMap = new Map(spots.map((s) => [s.id, s]));

/** 全局 UI 状态（轻量响应式：setState 后手动重渲染当前页） */
interface AppState {
  page: PageId;
  spotId: string;
  date: string;
  month: string;
}

export type PageId = 'calendar' | 'map' | 'weather' | 'plan';

const KEY = 'canglan.state.v1';
const PLANS_KEY = 'canglan.plans.v1';

function loadState(): AppState {
  const today = todayISO();
  const fallback: AppState = {
    page: 'calendar',
    spotId: spots[0].id,
    date: today,
    month: today.slice(0, 7),
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<AppState>) };
  } catch {
    /* 忽略损坏的本地存储 */
  }
  return fallback;
}

export const state = loadState();

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

const PLANS: FishingPlan[] = loadPlans();

function loadPlans(): FishingPlan[] {
  try {
    const raw = localStorage.getItem(PLANS_KEY);
    if (raw) return JSON.parse(raw) as FishingPlan[];
  } catch {
    /* ignore */
  }
  return [];
}

export function listPlans(): FishingPlan[] {
  return [...PLANS].sort((a, b) => (a.date + a.spotId).localeCompare(b.date + b.spotId));
}

export function addPlan(plan: FishingPlan): void {
  const idx = PLANS.findIndex((p) => p.id === plan.id);
  if (idx >= 0) PLANS[idx] = plan;
  else PLANS.push(plan);
  persistPlans();
}

export function removePlan(id: string): void {
  const idx = PLANS.findIndex((p) => p.id === id);
  if (idx >= 0) {
    PLANS.splice(idx, 1);
    persistPlans();
  }
}

function persistPlans(): void {
  try {
    localStorage.setItem(PLANS_KEY, JSON.stringify(PLANS));
  } catch {
    /* ignore */
  }
}

export const TIDE_TYPE_LABEL: Record<TideType, string> = {
  semidiurnal: '半日潮',
  mixed: '混合潮',
  diurnal: '全日潮',
};

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: '晴',
  partly_cloudy: '多云',
  cloudy: '阴',
  overcast: '阴云密布',
  drizzle: '小雨',
  rain: '中雨',
  heavy_rain: '大雨',
  thunderstorm: '雷暴',
};

export const WEATHER_ICON: Record<WeatherKind, string> = {
  clear: '☀',
  partly_cloudy: '⛅',
  cloudy: '☁',
  overcast: '🌥',
  drizzle: '🌦',
  rain: '🌧',
  heavy_rain: '⛈',
  thunderstorm: '⛈',
};

/** 蒲福风级 */
export function beaufort(ms: number): number {
  const table = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  let level = 0;
  while (level < table.length && ms >= table[level]) level++;
  return level;
}

export function compass(deg: number): string {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(deg / 45) % 8];
}
