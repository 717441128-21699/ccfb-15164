/**
 * Worker 端到端冒烟测试：用 worker_threads 加载真实的 tideWorker 模块，
 * 覆盖全部请求类型，确保 Worker 消息协议与引擎在独立线程中可用。
 */
import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type { WorkerRequest, WorkerResponse } from '../src/workers/protocol';

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(here, '../src/workers/tideWorker.ts');

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type ClientRequest = DistributiveOmit<WorkerRequest, 'reqId'>;

function call(req: ClientRequest): Promise<WorkerResponse> {
  const worker = new Worker(workerPath, {
    execArgv: ['--import', 'tsx'],
  });
  return new Promise((resolvePromise, reject) => {
    worker.once('message', (msg: WorkerResponse) => {
      worker.terminate();
      resolvePromise(msg);
    });
    worker.once('error', reject);
    worker.postMessage(req);
  });
}

describe('Web Worker 端到端（worker_threads）', () => {
  it('tideMonthAll：30 钓点整月数据结构完整', async () => {
    const res = await call({ type: 'tideMonthAll', month: '2026-11' });
    expect('error' in res).toBe(false);
    if (!('data' in res)) throw new Error('无数据');
    const data = res.data as Array<{ spotId: string; days: unknown[] }>;
    expect(data).toHaveLength(30);
    expect(data[0].days).toHaveLength(30);
  });

  it('tideDay：潮位序列与高低潮非空', async () => {
    const res = await call({ type: 'tideDay', spotId: 'SP01', date: '2026-11-22' });
    expect('error' in res).toBe(false);
    if (!('data' in res)) throw new Error('无数据');
    const d = res.data as { series: unknown[]; extremes: unknown[] };
    expect(d.series.length).toBeGreaterThan(100);
    expect(d.extremes.length).toBeGreaterThan(0);
  });

  it('weather：5 天预报为 40+ 个 3 小时格点', async () => {
    const res = await call({ type: 'weather', spotId: 'SP01', date: '2026-11-22', days: 5 });
    expect('error' in res).toBe(false);
    if (!('data' in res)) throw new Error('无数据');
    const d = res.data as { samples: unknown[] };
    expect(d.samples.length).toBeGreaterThanOrEqual(40);
  });

  it('planCompare：返回 30 个钓点评分且分数在 0~100', async () => {
    const res = await call({ type: 'planCompare', date: '2026-11-22' });
    expect('error' in res).toBe(false);
    if (!('data' in res)) throw new Error('无数据');
    const d = res.data as Array<{ spotId: string; windows: Array<{ activityScore: number }> }>;
    expect(d).toHaveLength(30);
    for (const r of d) {
      expect(r.windows.length).toBeGreaterThan(0);
      for (const w of r.windows) {
        expect(w.activityScore).toBeGreaterThanOrEqual(0);
        expect(w.activityScore).toBeLessThanOrEqual(100);
      }
    }
  });

  it('未知请求类型返回错误而不是崩溃', async () => {
    const res = await call({ type: 'extremesDay', spotId: 'NOT_EXIST', date: '2026-11-22' });
    expect('error' in res).toBe(true);
  });
});
