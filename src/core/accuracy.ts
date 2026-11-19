/**
 * 对齐精度评估：把 Viterbi 对齐结果与合成器输出的真值边界逐音素比较，
 * 统计边界误差（ms）、P95、最大值与「一帧内（33.3ms）」命中率。
 */
import { alignPhonemes } from './alignment';
import { parseLine } from './pinyin';
import { synthesizeLine, type GroundTruthBoundary, type VoiceProfile } from './synth';
import { mixWithBed } from './synth';
import type { AccuracyReport, AudioBufferLike, TimedPhoneme } from './types';
import { FRAME_SECONDS } from './types';

export interface EvalCase {
  id: string;
  text: string;
  profile: VoiceProfile;
  /** 是否混入背景音乐 + 音效。 */
  noisy: boolean;
  audio: AudioBufferLike;
  truth: GroundTruthBoundary[];
}

export interface EvalCaseResult {
  id: string;
  errorsMs: number[];
  meanErrorMs: number;
  maxErrorMs: number;
  withinOneFrame: number;
  total: number;
}

/** 由台词构造评估用例（含真值）。 */
export function buildEvalCase(
  id: string, text: string, profile: VoiceProfile, noisy: boolean, seed = 1,
): EvalCase {
  const parsed = parseLine(text);
  const synth = synthesizeLine(parsed.syllables, { profile, seed });
  const audio = noisy ? mixWithBed(synth.audio, { bgmGain: 0.2, sfxCount: 3 }) : synth.audio;
  return {
    id, text, profile, noisy, audio,
    truth: synth.boundaries,
  };
}

export function evaluateCase(c: EvalCase): EvalCaseResult {
  const parsed = parseLine(c.text);
  const { timed } = alignPhonemes(c.audio, parsed.phonemes, parsed.syllables);
  const errorsMs = compareBoundaries(timed, c.truth);
  const within = errorsMs.filter((e) => e <= FRAME_SECONDS * 1000).length;
  const sum = errorsMs.reduce((a, b) => a + b, 0);
  return {
    id: c.id,
    errorsMs,
    meanErrorMs: errorsMs.length ? sum / errorsMs.length : 0,
    maxErrorMs: errorsMs.length ? Math.max(...errorsMs) : 0,
    withinOneFrame: within,
    total: errorsMs.length,
  };
}

/**
 * 真值边界按 phonemeIndex 对齐；对齐输出保留了原音素 index。
 * 比较每个音素的 start（口型何时启动，是动画师最关心的量）。
 */
function compareBoundaries(
  timed: TimedPhoneme[], truth: GroundTruthBoundary[],
): number[] {
  const truthMap = new Map<number, GroundTruthBoundary>();
  for (const b of truth) truthMap.set(b.phonemeIndex, b);
  const errors: number[] = [];
  for (const p of timed) {
    const gt = truthMap.get(p.index);
    if (!gt) continue;
    errors.push(Math.abs(p.start - gt.start) * 1000);
  }
  return errors;
}

export function aggregate(results: EvalCaseResult[]): AccuracyReport {
  const all = results.flatMap((r) => r.errorsMs);
  if (!all.length) {
    return {
      clips: results.length, boundaryErrorsMs: [], meanErrorMs: 0, p95ErrorMs: 0,
      maxErrorMs: 0, withinOneFrameRatio: 0,
    };
  }
  const sorted = [...all].sort((a, b) => a - b);
  const sum = all.reduce((a, b) => a + b, 0);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const within = all.filter((e) => e <= FRAME_SECONDS * 1000).length;
  return {
    clips: results.length,
    boundaryErrorsMs: all,
    meanErrorMs: round2(sum / all.length),
    p95ErrorMs: round2(p95),
    maxErrorMs: round2(sorted[sorted.length - 1]),
    withinOneFrameRatio: round4(within / all.length),
  };
}

function round2(x: number): number { return Math.round(x * 100) / 100; }
function round4(x: number): number { return Math.round(x * 10000) / 10000; }
