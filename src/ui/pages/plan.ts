import type { FishingPlan, FishingWindow } from '../../types';
import { workerClient } from '../../workers/client';
import type { PlanDayResult } from '../../workers/protocol';
import { dom, clear, hm, todayISO } from '../dom';
import { addPlan, listPlans, removePlan, spotMap, state, TIDE_TYPE_LABEL } from '../state';
import { spotSelector } from '../components/spotSelector';

/** 出钓计划页：单钓点评分窗口 + 全海域钓点横向对比 + 计划收藏 */
export async function renderPlan(root: HTMLElement): Promise<void> {
  clear(root);
  const spot = spotMap.get(state.spotId)!;

  root.append(
    dom.div(
      { class: 'panel' },
      dom.h2({}, '🎣 出钓计划'),
      dom.div(
        { class: 'toolbar' },
        spotSelector(() => void renderPlan(root)),
        dom.input({
          type: 'date',
          value: state.date,
          onChange: (e: Event) => {
            state.date = (e.target as HTMLInputElement).value || todayISO();
            void renderPlan(root);
          },
        }),
        dom.button(
          { class: 'btn primary', onClick: () => void saveCurrent(spot.id, root) },
          '⭐ 收藏该钓点当日计划',
        ),
      ),
      dom.div({ id: 'plan-windows', class: 'loading' }, 'Worker 正在逐小时评估鱼情与抛竿指数…'),
      dom.div({ id: 'plan-compare', class: 'loading', style: 'margin-top:16px' }, '同时对比 30 个钓点…'),
      dom.div({ id: 'plan-saved', style: 'margin-top:16px' }),
    ),
  );

  const [dayResult, allResults] = await Promise.all([
    workerClient.planDay(spot.id, state.date),
    workerClient.planCompare(state.date),
  ]);

  const wEl = document.getElementById('plan-windows');
  if (wEl) {
    clear(wEl);
    wEl.classList.remove('loading');
    wEl.append(buildWindows(dayResult.windows));
  }

  const cEl = document.getElementById('plan-compare');
  if (cEl) {
    clear(cEl);
    cEl.classList.remove('loading');
    cEl.append(buildCompare(allResults));
  }

  const sEl = document.getElementById('plan-saved');
  if (sEl) {
    clear(sEl);
    sEl.append(buildSaved(root));
  }
}

function buildWindows(windows: FishingWindow[]): HTMLElement {
  const wrap = dom.div({});
  wrap.append(dom.div({ class: 'muted', style: 'margin-bottom:10px' }, '按 3 小时窗口评分（已按鱼情活跃度排序）：'));
  const grid = dom.div({ class: 'grid cols-3' });
  for (const w of windows) {
    grid.append(
      dom.div(
        { class: 'stat plan-card' },
        dom.div({ style: 'display:flex;justify-content:space-between;align-items:center' }, dom.span({ class: 'label' }, `${hm(w.start)} – ${hm(w.end)}`), dom.span({ class: 'badge ' + w.safety }, safetyLabel(w.safety))),
        dom.div({ style: 'margin:10px 0 6px;font-size:26px;font-weight:800' }, String(w.activityScore), dom.span({ class: 'unit' }, '鱼情分')),
        scoreBar(w.activityScore, w.activityScore < 45 ? 'danger' : w.activityScore < 65 ? 'warn' : ''),
        dom.div({ style: 'margin-top:8px' }, dom.span({ class: 'muted' }, '抛竿指数 '), dom.span({ style: 'font-weight:700' }, String(w.castingScore))),
        scoreBar(w.castingScore, w.castingScore < 45 ? 'danger' : w.castingScore < 65 ? 'warn' : ''),
        dom.div({ class: 'muted', style: 'margin-top:8px;line-height:1.6' }, w.reasons.length ? w.reasons.join('；') : '各项条件中规中矩'),
      ),
    );
  }
  wrap.append(grid);
  return wrap;
}

function buildCompare(results: PlanDayResult[]): HTMLElement {
  const ranked = results
    .map((r) => {
      const best = r.windows[0];
      return {
        spotId: r.spotId,
        activity: best?.activityScore ?? 0,
        casting: best?.castingScore ?? 0,
        safety: best?.safety ?? 'safe' as const,
        window: best,
      };
    })
    .sort((a, b) => b.activity - a.activity);

  const wrap = dom.div({ class: 'panel', style: 'box-shadow:none;background:var(--bg-soft)' });
  wrap.append(dom.h2({}, '🏆 全海域钓点鱼情排行（取当日最优 3 小时窗口）'));
  const scroll = dom.div({ class: 'table-scroll' });
  const table = dom.h('table', {});
  table.append(
    dom.h(
      'thead',
      {},
      dom.h(
        'tr',
        {},
        dom.h('th', {}, '排名'),
        dom.h('th', {}, '钓点'),
        dom.h('th', {}, '潮型'),
        dom.h('th', {}, '最佳时段'),
        dom.h('th', {}, '鱼情分'),
        dom.h('th', {}, '抛竿指数'),
        dom.h('th', {}, '安全'),
      ),
    ),
  );
  const tbody = dom.h('tbody', {});
  ranked.forEach((r, i) => {
    const sp = spotMap.get(r.spotId)!;
    tbody.append(
      dom.h(
        'tr',
        {
          style: r.spotId === state.spotId ? 'background:rgba(56,189,248,0.08)' : '',
          onClick: () => {
            state.spotId = r.spotId;
          },
        },
        dom.h('td', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
        dom.h('td', { style: 'font-weight:700;cursor:pointer;color:var(--accent)' }, sp.name),
        dom.h('td', {}, dom.span({ class: 'badge ' + sp.tideType }, TIDE_TYPE_LABEL[sp.tideType])),
        dom.h('td', {}, r.window ? `${hm(r.window.start)}–${hm(r.window.end)}` : '—'),
        dom.h('td', {}, scoreCell(r.activity)),
        dom.h('td', {}, scoreCell(r.casting)),
        dom.h('td', {}, dom.span({ class: 'badge ' + r.safety }, safetyLabel(r.safety))),
      ),
    );
  });
  table.append(tbody);
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function buildSaved(root: HTMLElement): HTMLElement {
  const plans = listPlans();
  const wrap = dom.div({ class: 'panel', style: 'box-shadow:none;background:var(--bg-soft)' });
  wrap.append(dom.h2({}, '📋 已收藏计划', dom.span({ class: 'muted', style: 'font-weight:400' }, `共 ${plans.length} 条，本地保存`)));
  if (!plans.length) {
    wrap.append(dom.div({ class: 'muted' }, '暂无收藏，点击上方按钮把当日钓点计划存下来。'));
    return wrap;
  }
  const list = dom.div({ class: 'grid cols-2' });
  for (const p of plans) {
    const sp = spotMap.get(p.spotId);
    list.append(
      dom.div(
        { class: 'stat' },
        dom.div({ style: 'display:flex;justify-content:space-between;align-items:center' }, dom.span({ style: 'font-weight:700' }, `${p.date} · ${sp?.name ?? p.spotId}`), dom.button({ class: 'btn danger', onClick: () => { removePlan(p.id); void renderPlan(root); } }, '删除')),
        dom.div({ class: 'muted', style: 'margin-top:6px' }, p.note || '（无备注）'),
      ),
    );
  }
  wrap.append(list);
  return wrap;
}

async function saveCurrent(spotId: string, root: HTMLElement): Promise<void> {
  const result = await workerClient.planDay(spotId, state.date);
  const best = result.windows[0];
  const plan: FishingPlan = {
    id: `${spotId}-${state.date}`,
    spotId,
    date: state.date,
    createdAt: Date.now(),
    note: best
      ? `最佳窗口 ${hm(best.start)}–${hm(best.end)}，鱼情 ${best.activityScore}，抛竿 ${best.castingScore}，${safetyLabel(best.safety)}`
      : '无可用窗口',
  };
  await workerClient.savePlan(plan);
  addPlan(plan);
  toast(`已收藏 ${spotMap.get(spotId)?.name} ${state.date} 的计划`);
  void renderPlan(root);
}

function scoreCell(score: number): HTMLElement {
  return dom.div({ style: 'display:flex;align-items:center;gap:8px' }, dom.span({}, String(score)), scoreBar(score, score < 45 ? 'danger' : score < 65 ? 'warn' : ''));
}

function scoreBar(score: number, cls: string): HTMLElement {
  return dom.div({ class: 'score-bar ' + cls }, dom.h('i', { style: `width:${Math.max(4, score)}%` }));
}

function safetyLabel(s: FishingWindow['safety']): string {
  return s === 'safe' ? '适宜' : s === 'caution' ? '谨慎' : '不宜';
}

function toast(msg: string): void {
  const el = dom.div({ class: 'toast' }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}
