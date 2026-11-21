import type { FishingSpot } from '../../types';
import { workerClient } from '../../workers/client';
import { dom, clear, fixed, hm } from '../dom';
import { spots, state, TIDE_TYPE_LABEL } from '../state';

const DOT_COLOR: Record<FishingSpot['tideType'], string> = {
  semidiurnal: '#38bdf8',
  mixed: '#a78bfa',
  diurnal: '#fbbf24',
};

const W = 960;
const H = 560;

/** 钓点地图页：SVG 虚构海图，按潮型分色，点击查看钓点卡片并联动全局选中 */
export async function renderMap(root: HTMLElement, goto: (page: 'calendar' | 'weather' | 'plan') => void): Promise<void> {
  clear(root);
  const panel = dom.div({ class: 'panel map-wrap' });
  panel.append(
    dom.h2(
      {},
      '🗺 沧澜海钓点海图',
      dom.span({ class: 'muted', style: 'font-weight:400' }, '圆点颜色 = 潮型；点击钓点查看详情'),
    ),
    dom.div(
      { class: 'legend', style: 'margin-bottom:10px' },
      ...(['semidiurnal', 'mixed', 'diurnal'] as const).map((t) =>
        dom.span({}, dom.h('i', { style: `background:${DOT_COLOR[t]}` }), TIDE_TYPE_LABEL[t]),
      ),
    ),
  );

  const svg = dom.svg('svg', { viewBox: `0 0 ${W} ${H}` });
  // 虚构岸线与岛礁
  svg.append(buildCoastline());

  for (const spot of spots) {
    const cx = 60 + spot.x * (W - 120);
    const cy = 40 + spot.y * (H - 90);
    const color = DOT_COLOR[spot.tideType];
    const g = dom.svg('g', {});
    g.append(
      dom.svg('circle', {
        class: 'spot-dot' + (spot.id === state.spotId ? ' selected' : ''),
        cx,
        cy,
        r: 7,
        fill: color,
        'fill-opacity': 0.9,
        'data-id': spot.id,
        onClick: () => {
          state.spotId = spot.id;
          void renderMap(root, goto);
        },
      }),
      dom.svg('text', { class: 'spot-label', x: cx + 11, y: cy + 4 }, spot.name),
    );
    svg.append(g);
  }
  panel.append(svg);
  root.append(panel);

  const detail = dom.div({ class: 'panel', id: 'spot-detail' });
  root.append(detail);
  await renderDetail(detail, goto);
}

function buildCoastline(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  const land = document.createElementNS(ns, 'path');
  land.setAttribute(
    'd',
    'M0,0 L960,0 L960,90 C880,120 820,70 740,110 C660,150 600,95 520,130 C440,165 380,120 300,150 C220,180 160,140 80,175 L0,185 Z',
  );
  land.setAttribute('fill', 'rgba(52,211,153,0.13)');
  land.setAttribute('stroke', 'rgba(52,211,153,0.5)');
  land.setAttribute('stroke-width', '1.5');
  g.append(land);

  // 两座岛屿
  for (const [ix, iy, rw, rh] of [
    [220, 330, 70, 34],
    [690, 400, 95, 42],
  ] as const) {
    const island = document.createElementNS(ns, 'ellipse');
    island.setAttribute('cx', String(ix));
    island.setAttribute('cy', String(iy));
    island.setAttribute('rx', String(rw));
    island.setAttribute('ry', String(rh));
    island.setAttribute('fill', 'rgba(52,211,153,0.1)');
    island.setAttribute('stroke', 'rgba(52,211,153,0.4)');
    g.append(island);
  }

  // 等深线
  for (const [cx, cy, r] of [
    [480, 320, 120],
    [480, 320, 190],
    [480, 320, 260],
  ] as const) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', 'rgba(143,176,199,0.15)');
    c.setAttribute('stroke-dasharray', '2 6');
    g.append(c);
  }
  return g;
}

async function renderDetail(container: HTMLElement, goto: (page: 'calendar' | 'weather' | 'plan') => void): Promise<void> {
  const spot = spots.find((s) => s.id === state.spotId)!;
  clear(container);
  container.append(dom.div({ class: 'loading' }, '读取该钓点今日潮位…'));

  const today = state.date;
  const [tide] = await Promise.all([
    workerClient.tideDay(spot.id, today, 30),
  ]);
  clear(container);
  container.classList.remove('loading');

  const m2 = spot.constituents.find((c) => c.name === 'M2')!;
  const s2 = spot.constituents.find((c) => c.name === 'S2')!;
  const k1 = spot.constituents.find((c) => c.name === 'K1')!;
  const o1 = spot.constituents.find((c) => c.name === 'O1')!;

  const next = tide.extremes[0];
  container.append(
    dom.h2({}, `📍 ${spot.name}`, dom.span({ class: 'badge ' + spot.tideType }, TIDE_TYPE_LABEL[spot.tideType])),
    dom.div(
      { class: 'grid cols-3' },
      stat('形态系数 F', fixed(spot.formFactor, 3)),
      stat('M2 振幅', `${fixed(m2.amplitude)} m`),
      stat('S2 振幅', `${fixed(s2.amplitude)} m`),
      stat('K1 振幅', `${fixed(k1.amplitude)} m`),
      stat('O1 振幅', `${fixed(o1.amplitude)} m`),
      stat('基准水深', `${fixed(spot.depth, 1)} m`),
      stat('平均海平面', `${fixed(spot.meanLevel)} m`),
      stat('岸线朝向', `${Math.round(spot.shoreOrientation)}°`),
      stat(
        `今日首个${next ? (next.kind === 'high' ? '高潮' : '低潮') : '潮候'}`,
        next ? `${hm(next.time)} · ${fixed(next.height)}m` : '—',
      ),
    ),
    dom.div(
      { class: 'toolbar', style: 'margin-top:14px;margin-bottom:0' },
      dom.button({ class: 'btn primary', onClick: () => goto('calendar') }, '查看潮汐日历 →'),
      dom.button({ class: 'btn', onClick: () => goto('weather') }, '天气预报 →'),
      dom.button({ class: 'btn', onClick: () => goto('plan') }, '出钓计划 →'),
    ),
  );
}

function stat(label: string, value: string): HTMLElement {
  return dom.div({ class: 'stat' }, dom.div({ class: 'label' }, label), dom.div({ class: 'value' }, value));
}
