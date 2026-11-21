import './styles.css';
import { dom } from './ui/dom';
import { setState, state, type PageId } from './ui/state';
import { renderCalendar } from './ui/pages/calendar';
import { renderMap } from './ui/pages/map';
import { renderWeather } from './ui/pages/weather';
import { renderPlan } from './ui/pages/plan';

const TABS: Array<{ id: PageId; label: string; icon: string }> = [
  { id: 'calendar', label: '潮汐日历', icon: '🌊' },
  { id: 'map', label: '钓点地图', icon: '🗺' },
  { id: 'weather', label: '天气预报', icon: '🌦' },
  { id: 'plan', label: '出钓计划', icon: '🎣' },
];

const app = document.getElementById('app');
if (!app) throw new Error('#app 挂载点缺失');
const rootEl: HTMLElement = app;

function shell(): void {
  rootEl.replaceChildren();
  const nav = dom.nav(
    { class: 'tabs' },
    ...TABS.map((t) =>
      dom.button(
        {
          class: t.id === state.page ? 'active' : '',
          onClick: () => {
            setState({ page: t.id });
            shell();
          },
        },
        `${t.icon} ${t.label}`,
      ),
    ),
  );

  rootEl.append(
    dom.header(
      { class: 'app-header' },
      dom.div(
        { class: 'brand' },
        dom.span({ class: 'logo' }, '🎏'),
        dom.div(
          {},
          dom.h1({}, '沧澜海钓 · 潮汐天气工作台'),
          dom.div({ class: 'sub' }, '调和常数潮汐引擎（M2/S2/N2/K2/K1/O1/P1/Q1）· Web Worker 离线计算'),
        ),
      ),
      nav,
    ),
    dom.main({ id: 'page-root' }),
    dom.footer(
      { class: 'foot' },
      '潮位由 8 分潮调和模型推算，含交点订正与逆气压/风增水修正 · 全部数据为合成虚构，仅用于游戏 · TypeScript + Vite',
    ),
  );

  const root = document.getElementById('page-root')!;
  void route(root);
}

async function route(root: HTMLElement): Promise<void> {
  try {
    switch (state.page) {
      case 'calendar':
        await renderCalendar(root);
        break;
      case 'map':
        await renderMap(root, (page) => {
          setState({ page });
          shell();
        });
        break;
      case 'weather':
        await renderWeather(root);
        break;
      case 'plan':
        await renderPlan(root);
        break;
    }
  } catch (err) {
    root.replaceChildren(
      dom.div(
        { class: 'panel', style: 'border-color:var(--danger)' },
        dom.h2({}, '❌ 页面渲染失败'),
        dom.div({ class: 'muted' }, err instanceof Error ? err.message : String(err)),
      ),
    );
  }
}

shell();
