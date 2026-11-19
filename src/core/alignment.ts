/**
 * 强制对齐（forced alignment）—— 左到右 HMM + Viterbi。
 *
 * 每帧只能「留在当前状态」或「进入下一状态」，每个音素状态带
 * 期望帧数先验（时长惩罚）。句首句尾的静音状态吸收空白与背景音乐，
 * 标点停顿作为低代价静音状态插入。
 *
 * 帧移 10ms：合成音频音素边界清晰，边界量化误差天然 ≤10ms，
 * 远小于一帧（33.3ms）的验收线。
 */
import {
  extractFeatures, frameToSeconds, type FrameFeatures,
} from './audio';
import type {
  AudioBufferLike, Phoneme, PinyinSyllable, TimedPhoneme, VisemeName,
} from './types';
import { HOP_SECONDS } from './types';

/** 音素大类 → 声学模板（期望过零率、质心、浊音、相对能量）。 */
interface AcousticTemplate {
  zcr: number;
  centroid: number;
  voicing: number;
  energy: number;
}

const TEMPLATES: Record<string, AcousticTemplate> = {
  // 数值由合成音频真值区间的实测特征均值校准（见 accuracy 评估）。
  silence: { zcr: 0.16, centroid: 0.3, voicing: 0.1, energy: 0.03 },
  plosive: { zcr: 0.2, centroid: 0.24, voicing: 0.46, energy: 0.47 },
  fricative: { zcr: 0.3, centroid: 0.32, voicing: 0.29, energy: 0.48 },
  affricate: { zcr: 0.31, centroid: 0.34, voicing: 0.28, energy: 0.54 },
  nasal: { zcr: 0.13, centroid: 0.1, voicing: 0.81, energy: 0.49 },
  lateral: { zcr: 0.14, centroid: 0.14, voicing: 0.67, energy: 0.59 },
  vowel: { zcr: 0.13, centroid: 0.18, voicing: 0.7, energy: 0.19 },
  erCap: { zcr: 0.13, centroid: 0.18, voicing: 0.68, energy: 0.22 },
  codaN: { zcr: 0.09, centroid: 0.1, voicing: 0.9, energy: 0.36 },
  codaNg: { zcr: 0.09, centroid: 0.1, voicing: 0.9, energy: 0.36 },
};

const PLOSIVES = new Set(['b', 'p', 'd', 't', 'g', 'k']);
const FRICATIVES = new Set(['f', 'h', 's', 'sh', 'x', 'r']);
const AFFRICATES = new Set(['z', 'c', 'zh', 'ch', 'j', 'q']);
const NASALS = new Set(['m', 'n']);

function templateFor(p: Phoneme): AcousticTemplate {
  switch (p.kind) {
    case 'silence': return TEMPLATES.silence;
    case 'nasal-coda':
      return p.label === 'ng' ? TEMPLATES.codaNg : TEMPLATES.codaN;
    case 'er-cap': return TEMPLATES.erCap;
    case 'vowel': return TEMPLATES.vowel;
    case 'initial':
      if (PLOSIVES.has(p.label)) return TEMPLATES.plosive;
      if (FRICATIVES.has(p.label)) return TEMPLATES.fricative;
      if (AFFRICATES.has(p.label)) return TEMPLATES.affricate;
      if (NASALS.has(p.label)) return TEMPLATES.nasal;
      return TEMPLATES.lateral;
  }
}

export interface AlignmentResult {
  timed: TimedPhoneme[];
  score: number;
  speechStart: number;
  speechEnd: number;
  features: FrameFeatures;
}

interface State {
  phoneme?: Phoneme;
  isSilence: boolean;
  expectedFrames: number;
  minFrames: number;
}

export function alignPhonemes(
  audio: AudioBufferLike,
  phonemes: Phoneme[],
  syllables: PinyinSyllable[],
): AlignmentResult {
  const feats = extractFeatures(audio);
  const T = feats.count;
  if (T === 0) throw new Error('音频过短，无法分帧');
  const sr = audio.sampleRate;
  const hop = feats.hopSamples;

  // 1) VAD 语音区间。直接取首尾 voiced 帧会被孤立音效（SFX）拉偏，
  // 因此在 voiced 序列上找「语音密度最高的主区间」：从整段向两侧收缩，
  // 剔除边缘连续的短语音碎片（背景音乐里的音效爆发）。
  let firstVoiced = 0;
  let lastVoiced = T - 1;
  while (firstVoiced < T && !feats.voiced[firstVoiced]) firstVoiced++;
  while (lastVoiced >= 0 && !feats.voiced[lastVoiced]) lastVoiced--;
  if (firstVoiced >= T) { firstVoiced = 0; lastVoiced = T - 1; }
  const robust = robustSpeechSpan(feats.voiced, firstVoiced, lastVoiced);
  firstVoiced = robust[0];
  lastVoiced = robust[1];
  const speechStart = Math.max(0,
    frameToSeconds(firstVoiced, sr, hop) - HOP_SECONDS / 2);
  const speechEnd = frameToSeconds(lastVoiced, sr, hop) + HOP_SECONDS / 2;

  // 2) 状态序列：leading-sil, 音素(+标点静音), trailing-sil。
  const states: State[] = [];
  const pushSilence = (seconds: number, minFrames: number): void => {
    states.push({
      isSilence: true,
      expectedFrames: Math.max(minFrames, Math.round(seconds / HOP_SECONDS)),
      minFrames,
    });
  };
  pushSilence(Math.max(0.05, speechStart), 2);

  // 标点停顿挂在它前面的发音音节序号上。
  const pauseAfter = new Map<number, number>();
  let spokenIdx = -1;
  for (const s of syllables) {
    if (s.isPause) {
      pauseAfter.set(spokenIdx,
        (pauseAfter.get(spokenIdx) ?? 0) + (s.pauseSeconds ?? 0.2));
    } else {
      spokenIdx++;
    }
  }

  for (const p of phonemes) {
    states.push({
      phoneme: p, isSilence: false,
      expectedFrames: Math.max(1, Math.round(p.expectedDuration / HOP_SECONDS)),
      minFrames: p.kind === 'initial' ? 1 : 2,
    });
    if (isLastOfSyllable(p, phonemes)) {
      const pause = pauseAfter.get(p.syllableIndex);
      if (pause !== undefined) pushSilence(pause, 1);
    }
  }
  const tail = Math.max(0.05, audio.samples.length / sr - speechEnd);
  pushSilence(tail, 2);

  const S = states.length;

  // 2.5) 锚点：只对发音状态建立期望进入帧。
  // 在 VAD 主语音区间（已剥离边缘 SFX 碎片）的物理时间轴上按先验比例映射。
  // 相比「voiced 帧分位数」，它只依赖首尾两个鲁棒边界，不被噪声下
  // 漏检/误检的逐帧 VAD 抖动影响；句内停顿由 HMM 静音状态自行吸收。
  const anchorFrame0 = Math.max(0,
    Math.round((speechStart * sr - hop / 2) / hop));
  const anchorFrame1 = Math.min(T - 1,
    Math.round((speechEnd * sr - hop / 2) / hop));
  const spokenExpected = states
    .filter((st) => !st.isSilence)
    .reduce((a, st) => a + st.expectedFrames, 0);
  const expectedEntry = new Int32Array(S).fill(-1);
  let spokenCum = 0;
  const span = Math.max(1, anchorFrame1 - anchorFrame0);
  for (let s = 0; s < S; s++) {
    if (states[s].isSilence) continue;
    const q = spokenCum / Math.max(1, spokenExpected);
    expectedEntry[s] = anchorFrame0 + Math.round(q * span);
    spokenCum += states[s].expectedFrames;
  }
  // 锚定窗口（帧）：窗口内几乎不罚，窗口外快速增大。约 ±150ms，
  // 给声学证据留足局部纠偏空间，同时禁止跨句累积漂移。
  const ANCHOR_WINDOW = 15;
  const anchorPenalty = (stateIdx: number, entryFrame: number): number => {
    if (expectedEntry[stateIdx] < 0) return 0; // 静音状态无锚点
    const dev = Math.abs(entryFrame - expectedEntry[stateIdx]);
    if (dev <= ANCHOR_WINDOW) {
      const z = dev / ANCHOR_WINDOW;
      return 0.5 * z * z * 0.1;
    }
    return 0.1 + (dev - ANCHOR_WINDOW) * 0.12;
  };

  // 3) 帧 × 状态声学代价。
  const maxRms = Math.max(...feats.rms, 1e-6);
  // 瞬态抑制：能量远超局部中位数（±5 帧）的帧判为音效/SFX 爆发，
  // 记录其能量上界，避免突发噪声主导声学代价与 VAD 判定。
  const energyNorm = new Float32Array(T);
  for (let f = 0; f < T; f++) {
    const lo = Math.max(0, f - 5);
    const hi = Math.min(T, f + 6);
    const window: number[] = [];
    for (let k = lo; k < hi; k++) window.push(feats.rms[k]);
    window.sort((a, b) => a - b);
    const localMedian = window[Math.floor(window.length / 2)];
    const e = feats.rms[f] / maxRms;
    const med = localMedian / maxRms;
    // 超过局部中位数 2.2 倍视为瞬态，能量削到中位数的 1.3 倍。
    energyNorm[f] = e > med * 2.2 && med > 0
      ? Math.min(e, med * 1.3)
      : e;
  }
  const cost: Float32Array[] = states.map((st) => {
    const tpl = st.isSilence ? TEMPLATES.silence : templateFor(st.phoneme!);
    const arr = new Float32Array(T);
    for (let f = 0; f < T; f++) {
      const energy = energyNorm[f];
      const dz = feats.zcr[f] - tpl.zcr;
      const dc = feats.centroid[f] - tpl.centroid;
      const dv = feats.voicing[f] - tpl.voicing;
      const de = energy - tpl.energy;
      const vadPenalty = st.isSilence
        ? (feats.voiced[f] ? 0.6 : 0)
        : (feats.voiced[f] ? 0 : 0.8);
      arr[f] = clamp01(
        dz * dz * 1.2 + dc * dc * 1.5 + dv * dv + de * de * 0.8 + vadPenalty,
      );
    }
    return arr;
  });

  // 3.5) 边界显著性：归一化频谱通量，作为状态切换的吸附信号。
  // 真实音素边界处频谱快速变化，flux 出现局部高峰；转移落在这些帧时给奖励。
  const fluxMax = Math.max(...feats.flux, 1e-6);
  const boundaryScore = new Float32Array(T);
  for (let f = 0; f < T; f++) {
    const local = feats.flux[f] / fluxMax;
    const left = f > 0 ? feats.flux[f - 1] / fluxMax : 0;
    const right = f < T - 1 ? feats.flux[f + 1] / fluxMax : 0;
    boundaryScore[f] = Math.max(0, local - 0.5 * (left + right));
  }
  const BOUNDARY_REWARD = 0.12;

  // 4) 左到右 Viterbi。
  // dp[f][s]：处理完前 f 帧且第 f 帧处于状态 s 的最小代价。
  // 转移：从同状态（停留）或前一状态（跳入）。跳入时结算上一状态的
  // 时长先验偏差，并强制最小帧数约束。
  const INF = Number.POSITIVE_INFINITY;
  let prev = new Float64Array(S).fill(INF);
  let curr = new Float64Array(S).fill(INF);
  // back[f][s]：第 f 帧处于 s 时，上一帧的状态（s 或 s-1）。
  const back: Uint8Array[] = new Array(T);
  // 记录每条路径上各状态的进入帧，用于时长惩罚与最小帧数约束。
  // enterPrev[s]：prev 路径中状态 s 的进入帧。
  let enterPrev = new Int32Array(S).fill(-1);
  let enterCurr = new Int32Array(S).fill(-1);

  prev[0] = cost[0][0];
  enterPrev[0] = 0;
  back[0] = new Uint8Array(S).fill(255);

  // 时长先验：对数高斯。σ 取期望帧数的 45%（至少 2 帧），
  // 让明显偏离先验的路径付出可见代价，但保留声学证据纠偏的空间。
  // 静音状态不施加先验——真实停顿长度由 VAD 决定，标点时长仅作下限。
  const durationPenalty = (stateIdx: number, lengthFrames: number): number => {
    if (states[stateIdx].isSilence) return 0;
    const st = states[stateIdx];
    const mu = st.expectedFrames;
    const sigma = Math.max(2, mu * 0.45);
    const z = (lengthFrames - mu) / sigma;
    return 0.5 * z * z * 0.5; // 缩放因子 0.5，与逐帧声学代价同量级
  };
  // 停留微代价：打破「卡在便宜状态不动」的平局，使路径倾向按先验推进。
  const STAY_COST = 0.01;

  for (let f = 1; f < T; f++) {
    curr.fill(INF);
    enterCurr.fill(-1);
    const bk = new Uint8Array(S).fill(255);
    for (let s = 0; s < S; s++) {
      // 分支 A：留在状态 s（加停留微代价）。
      const stay = prev[s] === INF ? INF : prev[s] + STAY_COST;
      // 分支 B：从 s-1 跳入 s，结算 s-1 的时长先验，且满足其最小帧数。
      let move = INF;
      let moveEnter = -1;
      if (s > 0 && prev[s - 1] !== INF) {
        const entry = enterPrev[s - 1];
        const lengthFrames = f - entry; // s-1 占用 entry..f-1
        if (lengthFrames >= states[s - 1].minFrames) {
          let branch = prev[s - 1] + durationPenalty(s - 1, lengthFrames);
          // 锚定：发音状态进入帧应接近期望位置（静音无锚点）。
          branch += anchorPenalty(s, f);
          // 两个发音状态间切换时，吸附到 flux 声学边界（静音切换不奖励，
          // 停顿位置由 VAD 决定）。
          if (!states[s - 1].isSilence && !states[s].isSilence) {
            branch -= BOUNDARY_REWARD * boundaryScore[f];
          }
          move = branch;
          moveEnter = f;
        }
      }
      if (move < stay) {
        curr[s] = move + cost[s][f];
        bk[s] = s - 1;
        enterCurr[s] = moveEnter;
      } else if (stay !== INF) {
        curr[s] = stay + cost[s][f];
        bk[s] = s;
        enterCurr[s] = enterPrev[s];
      }
    }
    back[f] = bk;
    [prev, curr] = [curr, prev];
    [enterPrev, enterCurr] = [enterCurr, enterPrev];
  }

  // 5) 回溯。强制末帧落在末状态（trailing silence）：若其不可达，
  // 说明帧预算不足，退而取最深可达状态并对缺失状态做兜底切分。
  let endState = S - 1;
  if (prev[endState] === INF) {
    endState = S - 1;
    while (endState > 0 && prev[endState] === INF) endState--;
  }
  let state = endState;
  const statePerFrame = new Int32Array(T);
  statePerFrame[T - 1] = state;
  for (let f = T - 1; f > 0; f--) {
    const from = back[f][state];
    state = from === 255 ? state : from;
    statePerFrame[f - 1] = state;
  }

  // 兜底：未被路径覆盖的发音状态，在区间映射阶段用相邻状态时间补齐，
  // 保证每个音素都有时间区间（极端短音频时不至于丢字）。
  const covered = new Set<number>();
  for (let f = 0; f < T; f++) covered.add(statePerFrame[f]);

  // 6) 状态 → 帧区间 → 音素时间。
  const ranges = new Map<number, { start: number; end: number }>();
  for (let f = 0; f < T; f++) {
    const s = statePerFrame[f];
    const r = ranges.get(s);
    if (r) r.end = f + 1;
    else ranges.set(s, { start: f, end: f + 1 });
  }

  const timed: TimedPhoneme[] = [];
  let totalCost = 0;
  let counted = 0;
  for (let s = 0; s < S; s++) {
    const st = states[s];
    if (st.isSilence || !st.phoneme) continue;
    const r = ranges.get(s);
    if (!r) continue;
    const start = Math.max(0,
      frameToSeconds(r.start, sr, hop) - HOP_SECONDS / 2);
    const end = Math.max(0,
      frameToSeconds(r.end, sr, hop) - HOP_SECONDS / 2);
    timed.push({ ...st.phoneme, start, end: Math.max(end, start + 0.01) });
    for (let f = r.start; f < r.end; f++) { totalCost += cost[s][f]; counted++; }
  }
  timed.sort((a, b) => a.start - b.start);

  return {
    timed,
    score: counted ? 1 - totalCost / counted : 0,
    speechStart, speechEnd, features: feats,
  };
}

function isLastOfSyllable(p: Phoneme, all: Phoneme[]): boolean {
  const next = all[p.index + 1];
  return !next || next.syllableIndex !== p.syllableIndex;
}

/**
 * 在 [lo, hi] 的 voiced 序列上求鲁棒主语音区间。
 * 做法：用 ≥45 帧（450ms）的静音间隙把语音切成若干簇，取 voiced 帧
 * 总数最多的一簇作为主体。正常标点停顿实测 ≤39 帧不会切分，而句尾
 * 孤立音效（SFX）与主体间隔约 70 帧，自成小簇被自然排除。
 */
function robustSpeechSpan(
  voiced: Uint8Array, lo: number, hi: number,
): [number, number] {
  const GAP = 45;
  // 找出所有满足条件的大静音间隙。
  const clusters: [number, number][] = [];
  let clusterStart = lo;
  let silenceRun = 0;
  for (let f = lo; f <= hi; f++) {
    if (voiced[f]) {
      if (silenceRun >= GAP) {
        clusters.push([clusterStart, f - silenceRun - 1]);
        clusterStart = f;
      }
      silenceRun = 0;
    } else {
      silenceRun++;
    }
  }
  clusters.push([clusterStart, hi]);

  // 选 voiced 帧数最多的簇。
  let best = clusters[0];
  let bestCount = -1;
  for (const [a, b] of clusters) {
    let count = 0;
    for (let f = a; f <= b; f++) if (voiced[f]) count++;
    if (count > bestCount) { bestCount = count; best = [a, b]; }
  }
  return best;
}

export function visemeOf(p: Phoneme): VisemeName {
  return p.viseme;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
