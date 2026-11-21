/**
 * 极简 DOM 构建器（无框架依赖，TypeScript 严格类型）。
 * HTML 与 SVG 标签分别走对应 TagNameMap，事件属性以函数识别。
 */
export type Child = Node | string | null | undefined | false;

type EventMap = HTMLElementEventMap & SVGElementEventMap;
type EventName = keyof EventMap;

export type Attrs = {
  [key: string]: string | number | boolean | null | undefined | EventListener;
};

function isEventListener(v: unknown): v is EventListener {
  return typeof v === 'function';
}

function applyAttrs(el: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && isEventListener(v)) {
      el.addEventListener(k.slice(2).toLowerCase() as EventName, v);
    } else if (k === 'class') {
      el.setAttribute('class', String(v));
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (k === 'value' && el instanceof HTMLInputElement) {
      el.value = String(v);
    } else {
      el.setAttribute(k, String(v === true ? '' : v));
    }
  }
}

function appendChildren(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

type ShortEl = (attrs?: Attrs, ...children: Child[]) => HTMLElement;
type ShortSvg = (tag: keyof SVGElementTagNameMap, attrs?: Attrs, ...children: Child[]) => SVGElement;

const short =
  (tag: keyof HTMLElementTagNameMap): ShortEl =>
  (attrs: Attrs = {}, ...children: Child[]) =>
    h(tag, attrs, ...children);

export const dom: {
  h: typeof h;
  svg: typeof svgEl;
  div: ShortEl;
  span: ShortEl;
  select: ShortEl;
  option: ShortEl;
  input: ShortEl;
  button: ShortEl;
  header: ShortEl;
  nav: ShortEl;
  main: ShortEl;
  footer: ShortEl;
  table: ShortEl;
  thead: ShortEl;
  tbody: ShortEl;
  tr: ShortEl;
  th: ShortEl;
  td: ShortEl;
  h1: ShortEl;
  h2: ShortEl;
  h3: ShortEl;
  p: ShortEl;
  label: ShortEl;
} = {
  h,
  svg: svgEl as ShortSvg as typeof svgEl,
  div: short('div'),
  span: short('span'),
  select: short('select'),
  option: short('option'),
  input: short('input'),
  button: short('button'),
  header: short('header'),
  nav: short('nav'),
  main: short('main'),
  footer: short('footer'),
  table: short('table'),
  thead: short('thead'),
  tbody: short('tbody'),
  tr: short('tr'),
  th: short('th'),
  td: short('td'),
  h1: short('h1'),
  h2: short('h2'),
  h3: short('h3'),
  p: short('p'),
  label: short('label'),
};

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** 数值 → 定宽小数文本 */
export function fixed(n: number, digits = 2): string {
  return n.toFixed(digits);
}

/** 时间戳 → HH:MM（东八区） */
export function hm(ms: number, zoneHours = 8): string {
  const d = new Date(ms + zoneHours * 3_600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 时间戳 → MM-DD HH:MM */
export function mdhm(ms: number, zoneHours = 8): string {
  const d = new Date(ms + zoneHours * 3_600_000);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 今天的 ISO 日期（东八区） */
export function todayISO(now = Date.now(), zoneHours = 8): string {
  const d = new Date(now + zoneHours * 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
