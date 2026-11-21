/**
 * 潮汐/天气计算 Worker。
 * 同一份引擎代码也可被 Node 端直接 import（benchmark、vitest），
 * Worker 只做消息分发与缓存，不含计算逻辑。
 */
import spotsData from '../data/spots.json';
import type { FishingSpot, TidePoint } from '../types';
import { buildDayCache, buildTideSeries, localMidnight } from '../engine/tide';
import { findExtremes } from '../engine/extremes';
import { buildSurgeTable, buildWeatherForecast } from '../engine/weather';
import { evaluateDay } from '../engine/plan';
import { ZONE_HOURS, type WorkerRequest, type WorkerResponse } from './protocol';

const spots = spotsData as FishingSpot[];
const spotMap = new Map(spots.map((s) => [s.id, s]));

function getSpot(id: string): FishingSpot {
  const s = spotMap.get(id);
  if (!s) throw new Error(`未知钓点: ${id}`);
  return s;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthDates(month: string): string[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function tideDay(spot: FishingSpot, date: string, stepMinutes: number) {
  const dayStart = localMidnight(date, ZONE_HOURS);
  const cache = buildDayCache(dayStart, ZONE_HOURS, spot.constituents);
  // 增水一天只算 26 个整点，潮位序列与极值共用
  const surgeTable = buildSurgeTable(spot, dayStart);
  const series: TidePoint[] = buildTideSeries(cache, spot.meanLevel, dayStart, stepMinutes, surgeTable);
  const extremes = findExtremes(spot, dayStart, ZONE_HOURS, surgeTable);
  return { spotId: spot.id, date, series, extremes };
}

function handle(req: WorkerRequest): unknown {
  switch (req.type) {
    case 'tideDay':
      return tideDay(getSpot(req.spotId), req.date, req.stepMinutes ?? 10);
    case 'tideMonth': {
      const spot = getSpot(req.spotId);
      const days = monthDates(req.month).map((d) => tideDay(spot, d, req.stepMinutes ?? 10));
      return [{ spotId: spot.id, month: req.month, days }];
    }
    case 'tideMonthAll':
      return spots.map((spot) => {
        const days = monthDates(req.month).map((d) => tideDay(spot, d, req.stepMinutes ?? 10));
        return { spotId: spot.id, month: req.month, days };
      });
    case 'extremesDay':
      return findExtremes(getSpot(req.spotId), localMidnight(req.date, ZONE_HOURS), ZONE_HOURS);
    case 'extremesMonth': {
      const spot = getSpot(req.spotId);
      return monthDates(req.month).flatMap((d) =>
        findExtremes(spot, localMidnight(d, ZONE_HOURS), ZONE_HOURS),
      );
    }
    case 'weather': {
      const spot = getSpot(req.spotId);
      return {
        spotId: spot.id,
        samples: buildWeatherForecast(spot, localMidnight(req.date, ZONE_HOURS), req.days),
      };
    }
    case 'planDay': {
      const spot = getSpot(req.spotId);
      return {
        spotId: spot.id,
        date: req.date,
        windows: evaluateDay(spot, localMidnight(req.date, ZONE_HOURS)),
      };
    }
    case 'planCompare':
      return spots.map((spot) => ({
        spotId: spot.id,
        date: req.date,
        windows: evaluateDay(spot, localMidnight(req.date, ZONE_HOURS)),
      }));
    case 'savePlan':
      return req.plan;
    default: {
      const exhaustive: never = req;
      throw new Error(`未支持的请求: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * 同时兼容浏览器 DedicatedWorker（self.onmessage/postMessage）
 * 与 Node worker_threads（parentPort 需从 node:worker_threads 动态导入），
 * 动态导入失败即视为浏览器环境，保证 Vite 打包不受影响。
 */
type ReplyPort = {
  on: (event: 'message', cb: (msg: WorkerRequest) => void) => void;
  postMessage: (msg: WorkerResponse) => void;
};

async function bootWorker(): Promise<void> {
  let nodePort: ReplyPort | null = null;
  try {
    const isNode =
      typeof process !== 'undefined' &&
      (process as { versions?: { node?: string } }).versions?.node !== undefined;
    if (isNode) {
      const threads = await import('node:worker_threads');
      nodePort = (threads.parentPort as unknown as ReplyPort) ?? null;
    }
  } catch {
    nodePort = null;
  }

  const scope = globalThis as unknown as {
    onmessage?: ((ev: MessageEvent<WorkerRequest>) => void) | null;
    postMessage?: (msg: WorkerResponse) => void;
  };

  const reply = (msg: WorkerResponse): void => {
    if (nodePort) nodePort.postMessage(msg);
    else scope.postMessage!(msg);
  };

  const dispatch = (req: WorkerRequest): void => {
    const reqId = req.reqId;
    try {
      const data = handle(req);
      reply({ reqType: req.type, reqId, data } as WorkerResponse);
    } catch (err) {
      reply({
        reqType: req.type,
        reqId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (nodePort) {
    nodePort.on('message', dispatch);
  } else {
    scope.onmessage = (ev: MessageEvent<WorkerRequest>) => dispatch(ev.data);
  }
}

void bootWorker();
