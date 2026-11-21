import type { WeatherSample } from '../../types';
import { workerClient } from '../../workers/client';
import { dom, clear, fixed, mdhm, pad } from '../dom';
import { beaufort, compass, spotMap, state, WEATHER_ICON, WEATHER_LABEL } from '../state';
import { spotSelector } from '../components/spotSelector';

const FORECAST_DAYS = 5;

/** 天气预报页：未来 5 天逐 3 小时预报 + 气压/风浪趋势 */
export async function renderWeather(root: HTMLElement): Promise<void> {
  clear(root);
  const spot = spotMap.get(state.spotId)!;
  root.append(
    dom.div(
      { class: 'panel' },
      dom.h2({}, '🌦 天气预报（确定性天气引擎，可复现）'),
      dom.div(
        { class: 'toolbar' },
        spotSelector(() => void renderWeather(root)),
        dom.span({ class: 'muted' }, `${spot.name} · 起始 ${state.date} · 未来 ${FORECAST_DAYS} 天 · 3 小时一格`),
      ),
      dom.div({ id: 'weather-body', class: 'loading' }, 'Worker 正在推演气压场、风场与降雨…'),
    ),
  );

  const { samples } = await workerClient.weather(spot.id, state.date, FORECAST_DAYS);
  const body = document.getElementById('weather-body');
  if (!body) return;
  clear(body);
  body.classList.remove('loading');

  // 关键统计
  const minP = Math.min(...samples.map((s) => s.pressure));
  const maxWind = Math.max(...samples.map((s) => s.gust));
  const rainHours = samples.filter((s) => s.rainfall > 0.1).length;
  const maxWave = Math.max(...samples.map((s) => s.waveHeight));
  body.append(
    dom.div(
      { class: 'grid cols-3', style: 'margin-bottom:16px' },
      stat('最低气压', `${fixed(minP, 1)} hPa`, minP < 1005 ? '低压系统过境，潮位将被抬升' : '气压整体平稳'),
      stat('最大阵风', `${fixed(maxWind, 1)} m/s`, `约 ${beaufort(maxWind)} 级风`),
      stat('降雨时次', `${rainHours} 格`, `每格 3 小时 · 最大波高 ${fixed(maxWave, 2)} m`),
    ),
    buildTrendChart(samples),
    buildForecastCards(samples),
  );
}

function buildTrendChart(samples: WeatherSample[]): HTMLElement {
  const W = 920;
  const H = 220;
  const PL = 46;
  const PR = 46;
  const PT = 16;
  const PB = 30;
  const svg = dom.svg('svg', { viewBox: `0 0 ${W} ${H}`, style: 'margin-bottom:18px' });

  const t0 = samples[0].time;
  const t1 = samples[samples.length - 1].time;
  const x = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);

  // 气压左轴
  const pMin = Math.min(...samples.map((s) => s.pressure)) - 3;
  const pMax = Math.max(...samples.map((s) => s.pressure)) + 3;
  const yP = (p: number) => PT + (1 - (p - pMin) / (pMax - pMin)) * (H - PT - PB);
  // 风右轴
  const wMax = Math.max(...samples.map((s) => s.gust)) * 1.15 + 0.5;
  const yW = (w: number) => PT + (1 - w / wMax) * (H - PT - PB);

  // 网格
  for (let i = 0; i <= 4; i++) {
    const yy = PT + ((H - PT - PB) * i) / 4;
    svg.append(dom.svg('line', { x1: PL, x2: W - PR, y1: yy, y2: yy, stroke: 'rgba(143,176,199,0.15)', 'stroke-dasharray': '3 4' }));
  }

  const pPath = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.time).toFixed(1)},${yP(s.pressure).toFixed(1)}`)
    .join(' ');
  const wPath = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.time).toFixed(1)},${yW(s.windSpeed).toFixed(1)}`)
    .join(' ');
  const gustPath = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.time).toFixed(1)},${yW(s.gust).toFixed(1)}`)
    .join(' ');

  svg.append(
    dom.svg('path', { d: pPath, fill: 'none', stroke: '#fbbf24', 'stroke-width': 2.2 }),
    dom.svg('path', { d: wPath, fill: 'none', stroke: '#38bdf8', 'stroke-width': 2 }),
    dom.svg('path', { d: gustPath, fill: 'none', stroke: '#f87171', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }),
  );

  // 1013.25 标准气压参考线
  if (pMin < 1013.25 && pMax > 1013.25) {
    svg.append(
      dom.svg('line', {
        x1: PL,
        x2: W - PR,
        y1: yP(1013.25),
        y2: yP(1013.25),
        stroke: 'rgba(251,191,36,0.35)',
        'stroke-dasharray': '2 5',
      }),
      dom.svg('text', { x: W - PR - 4, y: yP(1013.25) - 4, 'text-anchor': 'end', fill: '#fbbf24', 'font-size': 10 }, '1013.25 hPa'),
    );
  }

  // 轴标签
  svg.append(
    dom.svg('text', { x: 8, y: PT + 10, fill: '#fbbf24', 'font-size': 11 }, 'hPa'),
    dom.svg('text', { x: W - PR + 6, y: PT + 10, fill: '#38bdf8', 'font-size': 11 }, 'm/s'),
  );
  // 日期刻度
  const dayMs = 86_400_000;
  for (let t = Math.ceil(t0 / dayMs) * dayMs; t < t1; t += dayMs) {
    const d = new Date(t + 8 * 3_600_000);
    svg.append(
      dom.svg('text', { x: x(t), y: H - 8, 'text-anchor': 'middle', fill: '#8fb0c7', 'font-size': 11 },
        `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`),
    );
  }

  const wrap = dom.div({ class: 'panel', style: 'box-shadow:none;background:var(--bg-soft);padding:12px' });
  wrap.append(
    dom.div(
      { class: 'legend', style: 'margin-bottom:8px' },
      dom.span({}, dom.h('i', { style: 'background:#fbbf24' }), '海平面气压'),
      dom.span({}, dom.h('i', { style: 'background:#38bdf8' }), '风速'),
      dom.span({}, dom.h('i', { style: 'background:#f87171' }), '阵风'),
    ),
    svg,
  );
  return wrap;
}

function buildForecastCards(samples: WeatherSample[]): HTMLElement {
  const grid = dom.div({ class: 'grid cols-3' });
  for (const s of samples) {
    const rain = s.rainfall > 0.1 ? `${fixed(s.rainfall, 1)} mm/h` : '无降水';
    const surgeHint = 1013.25 - s.pressure;
    grid.append(
      dom.div(
        { class: 'stat weather-card' },
        dom.div(
          { style: 'display:flex;justify-content:space-between;align-items:center' },
          dom.span({ class: 'muted' }, mdhm(s.time)),
          dom.span({ class: 'icon' }, WEATHER_ICON[s.kind]),
        ),
        dom.div({ style: 'font-weight:700' }, WEATHER_LABEL[s.kind]),
        dom.div({ class: 'muted' }, `${fixed(s.pressure, 1)} hPa · ${compass(s.windDirection)}风 ${beaufort(s.windSpeed)}级 ${fixed(s.windSpeed, 1)}m/s`),
        dom.div({ class: 'muted' }, `阵风 ${fixed(s.gust, 1)} · 波高 ${fixed(s.waveHeight, 2)}m · ${rain}`),
        dom.div(
          { class: 'muted', style: surgeHint > 0 ? 'color:var(--good)' : 'color:var(--fg-dim)' },
          surgeHint > 0 ? `逆气压抬升约 ${fixed(surgeHint * 0.99, 1)} cm` : '逆气压效应不明显',
        ),
      ),
    );
  }
  return grid;
}

function stat(label: string, value: string, hint: string): HTMLElement {
  return dom.div(
    { class: 'stat' },
    dom.div({ class: 'label' }, label),
    dom.div({ class: 'value', style: 'font-size:18px' }, value),
    dom.div({ class: 'muted', style: 'margin-top:4px' }, hint),
  );
}
