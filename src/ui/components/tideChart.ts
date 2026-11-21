import type { TideExtreme, TidePoint } from '../../types';
import { dom, hm } from '../dom';

const W = 900;
const H = 280;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 34;

export function tideChart(series: TidePoint[], extremes: TideExtreme[]): SVGSVGElement {
  const svg = dom.svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': '当日潮位曲线',
  });
  if (series.length < 2) return svg;

  const t0 = series[0].time;
  const t1 = series[series.length - 1].time;
  const heights = series.map((p) => p.height);
  let min = Math.min(...heights);
  let max = Math.max(...heights);
  const pad = Math.max(0.15, (max - min) * 0.08);
  min -= pad;
  max += pad;

  const x = (t: number) => PAD_L + ((t - t0) / (t1 - t0)) * (W - PAD_L - PAD_R);
  const y = (h: number) => PAD_T + (1 - (h - min) / (max - min)) * (H - PAD_T - PAD_B);

  // 网格 + 纵轴刻度
  for (let i = 0; i <= 4; i++) {
    const hv = min + ((max - min) * i) / 4;
    const yy = y(hv);
    svg.append(
      dom.svg('line', {
        x1: PAD_L,
        x2: W - PAD_R,
        y1: yy,
        y2: yy,
        stroke: 'rgba(143,176,199,0.18)',
        'stroke-dasharray': '3 4',
      }),
      dom.svg('text', { x: PAD_L - 8, y: yy + 4, 'text-anchor': 'end', fill: '#8fb0c7', 'font-size': 11 }, hv.toFixed(1)),
    );
  }
  // 横轴小时刻度（每 3 小时）
  for (let h = 0; h <= 24; h += 3) {
    const tt = t0 + (h + 1) * 3_600_000; // 序列从 -1h 开始
    if (tt < t0 || tt > t1) continue;
    const xx = x(tt);
    svg.append(
      dom.svg('line', { x1: xx, x2: xx, y1: H - PAD_B, y2: H - PAD_B + 5, stroke: '#244766' }),
      dom.svg('text', { x: xx, y: H - PAD_B + 20, 'text-anchor': 'middle', fill: '#8fb0c7', 'font-size': 11 }, `${h}:00`),
    );
  }

  // 填充区域
  const linePath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.time).toFixed(1)},${y(p.height).toFixed(1)}`)
    .join(' ');
  const areaPath =
    `${linePath} L${x(t1).toFixed(1)},${y(min).toFixed(1)} L${x(t0).toFixed(1)},${y(min).toFixed(1)} Z`;
  svg.append(dom.svg('path', { d: areaPath, fill: 'rgba(56,189,248,0.14)', stroke: 'none' }));

  // 天文潮虚线（不含增水）
  const astroPath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.time).toFixed(1)},${y(p.astronomical).toFixed(1)}`)
    .join(' ');
  svg.append(
    dom.svg('path', {
      d: astroPath,
      fill: 'none',
      stroke: 'rgba(244,114,182,0.75)',
      'stroke-width': 1.4,
      'stroke-dasharray': '5 4',
    }),
  );

  // 总潮位主线
  svg.append(
    dom.svg('path', {
      d: linePath,
      fill: 'none',
      stroke: '#38bdf8',
      'stroke-width': 2.4,
      'stroke-linejoin': 'round',
    }),
  );

  // 高低潮标记
  for (const e of extremes) {
    if (e.time < t0 || e.time > t1) continue;
    const cx = x(e.time);
    const cy = y(e.height);
    const color = e.kind === 'high' ? '#7dd3fc' : '#f0abfc';
    svg.append(
      dom.svg('circle', { cx, cy, r: 4.5, fill: color, stroke: '#0b1622', 'stroke-width': 1.5 }),
      dom.svg(
        'text',
        { x: cx, y: cy + (e.kind === 'high' ? -10 : 18), 'text-anchor': 'middle', fill: color, 'font-size': 11, 'font-weight': 700 },
        `${hm(e.time)} ${e.height.toFixed(2)}`,
      ),
    );
  }

  return svg;
}
