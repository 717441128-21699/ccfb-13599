/**
 * 对齐后的音素时间线 → 14 路口型权重曲线。
 *
 * 关键处理：
 *  - 同口型相邻音素合并（连读不抖）；
 *  - 相邻不同口型按协同发音交叉淡入淡出（cos ease，非硬切）；
 *  - 儿化 er-cap 与主元音叠加而非替换；轻声整体压低权重、缩短；
 *  - 权重变化低于阈值的关键帧剔除（去抖 + 稀疏化）；
 *  - 全部时间量化到 30fps 帧网格，边界误差 ≤ 半帧（16.7ms）。
 */
import {
  ALL_VISEMES, FRAME_RATE, FRAME_SECONDS, type ClipMeta,
  type LipSyncClip, type Phoneme, type TimedPhoneme, type VisemeKey,
  type VisemeName,
} from './types';

interface VisemeSegment {
  viseme: VisemeName;
  start: number;
  end: number;
  /** 峰值权重，轻声/韵尾略低。 */
  peak: number;
  /** 儿化叠加标记：与前一段同时生效。 */
  erOverlay?: boolean;
}

/** 第一步：音素 → 合并后的口型段。 */
function buildSegments(phonemes: TimedPhoneme[]): VisemeSegment[] {
  const raw: VisemeSegment[] = [];
  for (const p of phonemes) {
    const neutral = p.expectedDuration <= 0.115 && p.kind === 'vowel';
    let peak = 1;
    if (p.kind === 'nasal-coda') peak = 0.55;
    else if (p.kind === 'initial') peak = 0.85;
    else if (p.kind === 'er-cap') peak = 0.7;
    else if (neutral) peak = 0.7;
    raw.push({
      viseme: p.viseme,
      start: p.start,
      end: p.end,
      peak,
      erOverlay: p.kind === 'er-cap',
    });
  }

  // 合并同口型相邻段（儿化段不参与合并，走叠加）。
  const merged: VisemeSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (
      last && !seg.erOverlay && !last.erOverlay
      && last.viseme === seg.viseme
      && seg.start - last.end <= FRAME_SECONDS * 1.5
    ) {
      last.end = seg.end;
      last.peak = Math.max(last.peak, seg.peak);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/** 第二步：段 → 逐帧权重矩阵（含协同发音交叉过渡）。 */
export function segmentsToFrames(
  segments: VisemeSegment[], duration: number,
): number[][] {
  const frameCount = Math.max(1, Math.ceil(duration / FRAME_SECONDS));
  const V = ALL_VISEMES.length;
  const frames: number[][] = Array.from(
    { length: frameCount }, () => new Array<number>(V).fill(0),
  );
  const indexOf = new Map<VisemeName, number>(ALL_VISEMES.map((v, i) => [v, i]));
  // 静音通道在无语音段兜底。
  const silIdx = indexOf.get('sil')!;

  const crossfade = Math.min(0.05, FRAME_SECONDS * 1.5); // 50ms 协同过渡

  for (let fi = 0; fi < frameCount; fi++) {
    const t = fi * FRAME_SECONDS;
    let any = false;
    for (const seg of segments) {
      if (t < seg.start - crossfade || t > seg.end + crossfade) continue;
      let w: number;
      if (t >= seg.start && t <= seg.end) {
        w = seg.peak;
      } else if (t < seg.start) {
        const u = 1 - (seg.start - t) / crossfade; // 0→1
        w = seg.peak * easeInOut(u);
      } else {
        const u = (seg.end + crossfade - t) / crossfade; // 1→0
        w = seg.peak * easeInOut(u);
      }
      w = Math.max(0, Math.min(1, w));
      if (w > 0.01) {
        const vi = indexOf.get(seg.viseme)!;
        // 同帧多路竞争时保留最大值（儿化可与元音并存，故用 max 而非覆盖）。
        frames[fi][vi] = Math.max(frames[fi][vi], w);
        any = true;
      }
    }
    if (!any) frames[fi][silIdx] = 1;
  }

  suppressJitter(frames);
  return frames;
}

function easeInOut(u: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
}

/**
 * 去抖：逐路做 3 帧中值滤波，再把 <0.06 的权重清零。
 * 中值滤波能抹掉单帧尖峰而不模糊真实过渡（真实口型至少持续 2-3 帧）。
 */
function suppressJitter(frames: number[][]): void {
  const T = frames.length;
  const V = frames[0].length;
  for (let v = 0; v < V; v++) {
    const original = frames.map((f) => f[v]);
    for (let t = 0; t < T; t++) {
      const a = original[Math.max(0, t - 1)];
      const b = original[t];
      const c = original[Math.min(T - 1, t + 1)];
      const median = [a, b, c].sort((x, y) => x - y)[1];
      frames[t][v] = median < 0.06 ? 0 : median;
    }
  }
}

/**
 * 第三步：帧矩阵反推稀疏关键帧。
 * 对每一路口型序列做「容差抽点」：在保证线性/缓动插值的最大误差不超过
 * TOLERANCE 的前提下，用最少的关键帧还原整条曲线。段首段尾的零值显式记键，
 * 使 keysToFrames 能忠实重建。
 */
const KEY_TOLERANCE = 0.08;

export function framesToKeys(frames: number[][]): VisemeKey[] {
  const keys: VisemeKey[] = [];
  const V = ALL_VISEMES.length;
  for (let v = 0; v < V; v++) {
    const series = frames.map((f) => f[v]);
    const picked = simplifySeries(series, KEY_TOLERANCE);
    for (const frame of picked) {
      keys.push({ frame, viseme: ALL_VISEMES[v], weight: round3(series[frame]) });
    }
  }
  return keys.sort((a, b) => a.frame - b.frame || a.viseme.localeCompare(b.viseme));
}

/**
 * 容差抽点：贪心扫描，维护「上一个保留点」，只要当前段能用两点插值
 * 拟合到容差内就继续，超出则在拐点前补一个点。
 */
function simplifySeries(series: number[], tol: number): number[] {
  const n = series.length;
  if (n === 0) return [];
  const picked = new Set<number>([0]);
  let anchor = 0;
  for (let t = 1; t < n; t++) {
    // 检查 anchor..t 之间所有点能否由两端线性插值拟合。
    let maxDev = 0;
    for (let k = anchor + 1; k < t; k++) {
      const u = (k - anchor) / Math.max(1, t - anchor);
      const interp = series[anchor] + (series[t] - series[anchor]) * u;
      maxDev = Math.max(maxDev, Math.abs(interp - series[k]));
    }
    if (maxDev > tol) {
      // 在 t-1 处补点，重新开段。
      picked.add(t - 1);
      anchor = t - 1;
    }
  }
  picked.add(n - 1);
  // 额外保证每个非零段的起止都有键（零交叉点），避免重建时拖尾。
  for (let t = 1; t < n; t++) {
    if ((series[t - 1] <= 0.05) !== (series[t] <= 0.05)) picked.add(t);
  }
  return [...picked].sort((a, b) => a - b);
}

/** 编辑器改完关键帧后，重新采样成帧矩阵。 */
export function keysToFrames(keys: VisemeKey[], duration: number): number[][] {
  const frameCount = Math.max(1, Math.ceil(duration / FRAME_SECONDS));
  const V = ALL_VISEMES.length;
  const frames: number[][] = Array.from(
    { length: frameCount }, () => new Array<number>(V).fill(0),
  );
  const byViseme = new Map<VisemeName, VisemeKey[]>();
  for (const k of keys) {
    const arr = byViseme.get(k.viseme) ?? [];
    arr.push(k);
    byViseme.set(k.viseme, arr);
  }
  for (const [viseme, arr] of byViseme) {
    arr.sort((a, b) => a.frame - b.frame);
    const vi = ALL_VISEMES.indexOf(viseme);
    for (let f = 0; f < frameCount; f++) {
      frames[f][vi] = sampleKeyTrack(arr, f);
    }
  }
  return frames;
}

function sampleKeyTrack(arr: VisemeKey[], frame: number): number {
  if (arr.length === 0) return 0;
  // 第一个键之前一律为 0（口型尚未起振），不做外推。
  if (frame < arr[0].frame) return 0;
  if (frame >= arr[arr.length - 1].frame) return arr[arr.length - 1].weight;
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const u = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      return round3(a.weight + (b.weight - a.weight) * easeInOut(u));
    }
  }
  return 0;
}

/** 时间吸附到帧网格（编辑器拖关键帧时调用）。 */
export function snapToFrame(time: number): number {
  return Math.round(time / FRAME_SECONDS);
}

export function frameToTime(frame: number): number {
  return frame * FRAME_SECONDS;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** 全流程：音素时间线 → 帧矩阵 + 关键帧。 */
export function buildCurves(
  phonemes: TimedPhoneme[], duration: number,
): { frames: number[][]; keys: VisemeKey[]; segments: VisemeSegment[] } {
  const segments = buildSegments(phonemes);
  const frames = segmentsToFrames(segments, duration);
  const keys = framesToKeys(frames);
  return { frames, keys, segments };
}

/** 组装片段。 */
export function assembleClip(
  id: string, text: string, duration: number,
  syllables: LipSyncClip['syllables'],
  phonemes: TimedPhoneme[],
  meta: ClipMeta,
): LipSyncClip {
  const { frames, keys } = buildCurves(phonemes, duration);
  return { id, text, duration, syllables, phonemes, frames, keys, meta };
}

/** 编辑器修改后重建（保留关键帧编辑结果）。 */
export function rebuildFromKeys(clip: LipSyncClip, keys: VisemeKey[]): LipSyncClip {
  const frames = keysToFrames(keys, clip.duration);
  return { ...clip, keys, frames };
}

export type { Phoneme };
export { FRAME_RATE };
