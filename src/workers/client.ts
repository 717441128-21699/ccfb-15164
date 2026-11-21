/**
 * Worker 客户端：Promise 化封装，主线程页面只面对 async 方法。
 */
import type {
  FishingPlan,
  TideExtreme,
  WeatherSample,
} from '../types';
import type {
  PlanDayResult,
  TideDayResult,
  TideMonthResult,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

type PendingResolver = {
  resolve: (data: never) => void;
  reject: (err: Error) => void;
};

/** 对判别联合保持分配性的 Omit（去掉每支上的 reqId） */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type ClientRequest = DistributiveOmit<WorkerRequest, 'reqId'>;

export class TideWorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, PendingResolver>();

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./tideWorker.ts', import.meta.url), {
        type: 'module',
        name: 'tide-engine',
      });
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        const p = this.pending.get(msg.reqId);
        if (!p) return;
        this.pending.delete(msg.reqId);
        if ('error' in msg) {
          p.reject(new Error(msg.error));
        } else {
          p.resolve(msg.data as never);
        }
      };
      this.worker.onerror = (ev) => {
        for (const [id, p] of this.pending) {
          p.reject(new Error(ev.message || 'Worker 运行失败'));
          this.pending.delete(id);
        }
      };
    }
    return this.worker;
  }

  private call<T>(req: ClientRequest): Promise<T> {
    const reqId = ++this.seq;
    const worker = this.ensure();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as PendingResolver['resolve'], reject });
      worker.postMessage({ ...req, reqId });
    });
  }

  tideDay(spotId: string, date: string, stepMinutes = 10): Promise<TideDayResult> {
    return this.call<TideDayResult>({ type: 'tideDay', spotId, date, stepMinutes });
  }

  tideMonth(spotId: string, month: string, stepMinutes = 10): Promise<TideMonthResult[]> {
    return this.call<TideMonthResult[]>({ type: 'tideMonth', spotId, month, stepMinutes });
  }

  tideMonthAll(month: string, stepMinutes = 10): Promise<TideMonthResult[]> {
    return this.call<TideMonthResult[]>({ type: 'tideMonthAll', month, stepMinutes });
  }

  extremesDay(spotId: string, date: string): Promise<TideExtreme[]> {
    return this.call<TideExtreme[]>({ type: 'extremesDay', spotId, date });
  }

  weather(
    spotId: string,
    date: string,
    days: number,
  ): Promise<{ spotId: string; samples: WeatherSample[] }> {
    return this.call({ type: 'weather', spotId, date, days });
  }

  planDay(spotId: string, date: string): Promise<PlanDayResult> {
    return this.call<PlanDayResult>({ type: 'planDay', spotId, date });
  }

  planCompare(date: string): Promise<PlanDayResult[]> {
    return this.call<PlanDayResult[]>({ type: 'planCompare', date });
  }

  savePlan(plan: FishingPlan): Promise<FishingPlan> {
    return this.call<FishingPlan>({ type: 'savePlan', plan });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export const workerClient = new TideWorkerClient();
