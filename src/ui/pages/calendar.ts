import type { TideExtreme, TidePoint } from '../../types';
import { workerClient } from '../../workers/client';
import type { TideMonthResult } from '../../workers/protocol';
import { dom, clear, fixed, hm, shiftMonth } from '../dom';
import { spotMap, state, TIDE_TYPE_LABEL } from '../state';
import { spotSelector } from '../components/spotSelector';
import { tideChart } from '../components/tideChart';

const DOW = ['日', '一', '二', '三', '四', '五', '六'];

/** 潮汐日历页：月历概览 + 当日曲线与高低潮明细 */
export async function renderCalendar(root: HTMLElement): Promise<void> {
  clear(root);
  const spot = spotMap.get(state.spotId)!;

  root.append(
    dom.div(
      { class: 'panel' },
      dom.h2({}, `🌊 潮汐日历 · ${spot.name}`),
      dom.div(
        { class: 'toolbar' },
        spotSelector(() => void renderCalendar(root)),
        dom.button(
          { class: 'btn ghost', onClick: () => { state.month = shiftMonth(state.month, -1); void renderCalendar(root); } },
          '← 上月',
        ),
        dom.span({ class: 'badge ' + spot.tideType }, TIDE_TYPE_LABEL[spot.tideType]),
        dom.span({ style: 'font-weight:700;font-size:15px' }, state.month),
        dom.button(
          { class: 'btn ghost', onClick: () => { state.month = shiftMonth(state.month, 1); void renderCalendar(root); } },
          '下月 →',
        ),
        dom.span(
          { class: 'muted' },
          `形态系数 F=${fixed(spot.formFactor, 2)} · 平均海平面 ${fixed(spot.meanLevel)}m · 基准水深 ${fixed(spot.depth, 1)}m`,
        ),
      ),
      dom.div({ id: 'cal-body', class: 'loading' }, '正在 Worker 中推算整月调和潮位…'),
    ),
  );

  const [monthData] = await workerClient.tideMonth(state.spotId, state.month, 10);
  const body = document.getElementById('cal-body');
  if (!body) return;
  clear(body);
  body.classList.remove('loading');
  body.append(buildCalendarGrid(monthData, root));

  // 默认展示选中日期（或当月 1 日）的详细曲线
  const selected = monthData.days.find((d) => d.date === state.date) ?? monthData.days[0];
  state.date = selected.date;
  body.append(buildDayDetail(selected.series, selected.extremes));
}

function buildCalendarGrid(monthData: TideMonthResult, root: HTMLElement): HTMLElement {
  const [y, m] = state.month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells = dom.div({ class: 'calendar-grid' });
  for (const d of DOW) cells.append(dom.div({ class: 'dow' }, d));

  // 前置空白
  for (let i = 0; i < firstDow; i++) cells.append(dom.div({}));

  for (const day of monthData.days) {
    const dayNum = Number(day.date.slice(8));
    const highs = day.extremes.filter((e) => e.kind === 'high');
    const lows = day.extremes.filter((e) => e.kind === 'low');
    const isSelected = day.date === state.date;
    const cell = dom.div(
      {
        class: 'cal-cell' + (isSelected ? ' selected' : ''),
        style: isSelected ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)' : '',
        onClick: () => {
          state.date = day.date;
          void renderCalendar(root);
        },
      },
      dom.div({ class: 'date-num' }, `${dayNum}`),
      ...highs.slice(0, 2).map((e) =>
        dom.div({ class: 'mini-extreme high' }, dom.span({}, '高'), dom.span({}, `${hm(e.time)} ${fixed(e.height)}m`)),
      ),
      ...lows.slice(0, 2).map((e) =>
        dom.div({ class: 'mini-extreme low' }, dom.span({}, '低'), dom.span({}, `${hm(e.time)} ${fixed(e.height)}m`)),
      ),
    );
    cells.append(cell);
  }
  return cells;
}

function buildDayDetail(series: TidePoint[], extremes: TideExtreme[]): HTMLElement {
  const panel = dom.div({ class: 'panel' });
  panel.append(
    dom.h2({}, `📈 ${state.date} 潮位过程线`),
    dom.div(
      { class: 'legend' },
      dom.span({}, dom.h('i', { style: 'background:#38bdf8' }), '总潮高（含气象增水）'),
      dom.span({}, dom.h('i', { style: 'background:#f472b6' }), '纯天文潮高'),
      dom.span({}, '纵轴单位：米（相对海图基准）'),
    ),
    tideChart(series, extremes),
  );

  const wrap = dom.div({ class: 'table-scroll', style: 'margin-top:14px' });
  const table = dom.h('table', {});
  table.append(
    dom.h(
      'thead',
      {},
      dom.h('tr', {}, dom.h('th', {}, '类型'), dom.h('th', {}, '时刻'), dom.h('th', {}, '潮高(m)')),
    ),
  );
  const tbody = dom.h('tbody', {});
  for (const e of extremes) {
    tbody.append(
      dom.h(
        'tr',
        {},
        dom.h('td', {}, e.kind === 'high' ? '🔺 高潮' : '🔻 低潮'),
        dom.h('td', {}, hm(e.time)),
        dom.h('td', {}, fixed(e.height, 3)),
      ),
    );
  }
  table.append(tbody);
  wrap.append(table);
  panel.append(wrap);

  const maxSurge = Math.max(...series.map((p) => Math.abs(p.surge)));
  panel.append(
    dom.div(
      { class: 'muted', style: 'margin-top:10px' },
      `当日最大气象增水绝对值 ${fixed(maxSurge * 100, 1)} cm（逆气压效应 + 向岸风增水）；共 ${extremes.length} 个高低潮。`,
    ),
  );
  return panel;
}
