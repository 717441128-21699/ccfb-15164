/**
 * 独立参考实现：每个时刻完整重算天文幅角、交点因子，
 * 不使用任何日缓存或速度外推。用于与快速引擎交叉验证，
 * 两条代码路径除了调和常数外不共享相位组装逻辑。
 */
import type { Constituent } from '../types';
import {
  type ConstituentName,
  computeAstronomy,
  equilibriumArguments,
  nodeCorrections,
} from './astronomy';
import { DEG } from './math';

/** 全量参考潮高计算（纯天文部分，米） */
export function referenceAstronomical(
  timeMs: number,
  constituents: Constituent[],
): number {
  const astro = computeAstronomy(timeMs);
  const v = equilibriumArguments(astro);
  const nodes = nodeCorrections(astro);
  let h = 0;
  for (const c of constituents) {
    const name = c.name as ConstituentName;
    const node = nodes[name];
    const theta = (v[name] + node.u - c.phaseLag) * DEG;
    h += node.f * c.amplitude * Math.cos(theta);
  }
  return h;
}
