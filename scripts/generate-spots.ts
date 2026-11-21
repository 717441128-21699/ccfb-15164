/**
 * 生成 30 个虚构钓点的调和常数与基础属性，输出 src/data/spots.json。
 * 潮型由形态系数 F=(H_K1+H_O1)/(H_M2+H_S2) 自然决定：
 *   F<0.25 半日潮 | 0.25≤F<3 混合潮 | F≥3 全日潮
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Constituent, FishingSpot, TideType } from '../src/types';
import { mulberry32 } from '../src/engine/math';

const here = dirname(fileURLToPath(import.meta.url));
const NAMES: Record<TideType, string[]> = {
  semidiurnal: [
    '双澜礁', '银沙湾', '铁砧屿', '白鹭门', '青潮角', '听涛码头',
    '沉箱湾', '黑石排', '月牙滩', '灯塔脚', '回澜渡', '碎浪岬',
  ],
  mixed: [
    '雾岚水道', '赤屿东礁', '黄礁盘', '孤星台', '风信子湾', '暗流嘴',
    '七星排', '铜锅湾', '暮潮矶', '横沙尾', '鬼仔石', '望洋崖',
  ],
  diurnal: [
    '逐日湾', '长汐角', '金轮滩', '眠月礁', '单潮屿', '回音壁',
  ],
};

interface Profile {
  type: TideType;
  m2: [number, number];
  s2: number; // 相对 M2 的比例
  n2: number;
  k2: number;
  k1: [number, number];
  o1: [number, number];
  p1: number; // 相对 K1
  q1: number; // 相对 O1
}

const PROFILES: Profile[] = [
  // 12 个半日潮点：F 控制在 0.05~0.22
  {
    type: 'semidiurnal',
    m2: [1.4, 3.2], s2: 0.32, n2: 0.2, k2: 0.09,
    k1: [0.08, 0.28], o1: [0.07, 0.26], p1: 0.33, q1: 0.19,
  },
  // 12 个混合潮点：F 控制在 0.5~2.2
  {
    type: 'mixed',
    m2: [0.45, 1.1], s2: 0.28, n2: 0.18, k2: 0.08,
    k1: [0.35, 0.95], o1: [0.3, 0.85], p1: 0.33, q1: 0.19,
  },
  // 6 个全日潮点：F 控制在 3.2~6
  {
    type: 'diurnal',
    m2: [0.12, 0.32], s2: 0.25, n2: 0.17, k2: 0.07,
    k1: [0.7, 1.35], o1: [0.6, 1.2], p1: 0.33, q1: 0.19,
  },
];

function makeConstituents(rand: () => number, p: Profile): Constituent[] {
  const m2 = lerp(...p.m2, rand());
  const k1 = lerp(...p.k1, rand());
  const o1 = lerp(...p.o1, rand());
  const amp: Record<string, number> = {
    M2: round3(m2),
    S2: round3(m2 * p.s2 * (0.85 + 0.3 * rand())),
    N2: round3(m2 * p.n2 * (0.85 + 0.3 * rand())),
    K2: round3(m2 * p.k2 * (0.8 + 0.4 * rand())),
    K1: round3(k1),
    O1: round3(o1),
    P1: round3(k1 * p.p1 * (0.9 + 0.2 * rand())),
    Q1: round3(o1 * p.q1 * (0.9 + 0.2 * rand())),
  };
  return Object.entries(amp).map(([name, amplitude]) => ({
    name,
    amplitude,
    phaseLag: Math.round(rand() * 3600) / 10, // 0.1° 精度
  }));
}

function main(): void {
  const rand = mulberry32(20261122);
  const spots: FishingSpot[] = [];
  let idx = 0;

  PROFILES.forEach((profile, pi) => {
    const count = profile.type === 'diurnal' ? 6 : 12;
    const names = NAMES[profile.type];
    for (let i = 0; i < count; i++) {
      const constituents = makeConstituents(rand, profile);
      const get = (n: string) => constituents.find((c) => c.name === n)!.amplitude;
      const formFactor = round3((get('K1') + get('O1')) / (get('M2') + get('S2')));

      // 三类潮点在地图上各占一片海湾
      const clusterX = [0.18, 0.5, 0.82][pi];
      const clusterY = [0.3, 0.55, 0.35][pi];
      const x = clamp01(clusterX + (rand() - 0.5) * 0.22);
      const y = clamp01(clusterY + (rand() - 0.5) * 0.4);

      spots.push({
        id: `SP${String(idx + 1).padStart(2, '0')}`,
        name: names[i],
        x: round3(x),
        y: round3(y),
        shoreOrientation: Math.round(rand() * 360),
        depth: round1(5 + rand() * 35),
        meanLevel: round2(1.6 + rand() * 1.4),
        weatherSeed: Math.floor(rand() * 1_000_000_000) + 1,
        constituents,
        formFactor,
        tideType: profile.type,
      });
      idx++;
    }
  });

  // 自检：潮型分布与形态系数边界
  const byType = spots.reduce<Record<string, number>>((acc, s) => {
    acc[s.tideType] = (acc[s.tideType] ?? 0) + 1;
    return acc;
  }, {});
  const bad = spots.filter((s) => {
    if (s.tideType === 'semidiurnal') return s.formFactor >= 0.25;
    if (s.tideType === 'diurnal') return s.formFactor < 3;
    return s.formFactor < 0.25 || s.formFactor >= 3;
  });
  console.log('潮型分布:', byType);
  console.log('形态系数范围:', minMax(spots.map((s) => s.formFactor)));
  if (bad.length) {
    console.error('潮型与形态系数不符:', bad.map((s) => `${s.id}(${s.formFactor})`));
    process.exit(1);
  }

  const out = resolve(here, '../src/data/spots.json');
  writeFileSync(out, JSON.stringify(spots, null, 2), 'utf8');
  console.log(`已写入 ${out}（${spots.length} 个钓点）`);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const minMax = (xs: number[]) => [Math.min(...xs), Math.max(...xs)];

main();
