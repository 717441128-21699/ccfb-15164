import { dom } from '../dom';
import { spots, state, TIDE_TYPE_LABEL } from '../state';

/** 钓点下拉选择（带潮型标注），切换后写全局状态并触发回调 */
export function spotSelector(onChange: (spotId: string) => void): HTMLElement {
  const sel = dom.select(
    {
      'aria-label': '选择钓点',
      onChange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        state.spotId = id;
        onChange(id);
      },
    },
    ...spots.map((s) =>
      dom.option(
        { value: s.id, selected: s.id === state.spotId ? true : undefined },
        `${s.name} · ${TIDE_TYPE_LABEL[s.tideType]}`,
      ),
    ),
  );
  return sel;
}
