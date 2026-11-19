import { describe, expect, it } from 'vitest';
import { alignPhonemes } from '../src/core/alignment.ts';
import { parseLine } from '../src/core/pinyin.ts';
import { mixWithBed, synthesizeLine, VOICE_PROFILES } from '../src/core/synth.ts';
import { FRAME_SECONDS } from '../src/core/types.ts';

function boundaryErrors(text: string, noisy = false, seed = 7) {
  const parsed = parseLine(text);
  const synth = synthesizeLine(parsed.syllables, { seed });
  const audio = noisy
    ? mixWithBed(synth.audio, { bgmGain: 0.2, sfxCount: 3, seed })
    : synth.audio;
  const { timed } = alignPhonemes(audio, parsed.phonemes, parsed.syllables);
  const truth = new Map(synth.boundaries.map((b) => [b.phonemeIndex, b]));
  const errors: number[] = [];
  for (const p of timed) {
    const gt = truth.get(p.index);
    if (gt) errors.push(Math.abs(p.start - gt.start) * 1000);
  }
  return { errors, timed, expected: parsed.phonemes.length };
}

describe('强制对齐精度', () => {
  const lines = [
    '你好，欢迎来到我们的游戏世界。',
    '站住！不许跑！',
    '这个小孩儿真可爱。',
    '请稍等一下，我马上就来。',
    '春天到了，花儿都开了，小鸟在树上唱歌。',
  ];

  it('干净音频：每个音素都产出时间区间且单调不减', () => {
    const { timed, expected } = boundaryErrors(lines[0]);
    expect(timed.length).toBe(expected);
    for (let i = 1; i < timed.length; i++) {
      expect(timed[i].start).toBeGreaterThanOrEqual(timed[i - 1].start - 1e-6);
      expect(timed[i].end).toBeGreaterThan(timed[i].start);
    }
  });

  it('干净音频：平均边界误差受控（≤50ms，约 1.5 帧）', () => {
    const all: number[] = [];
    for (const line of lines) all.push(...boundaryErrors(line).errors);
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeLessThanOrEqual(50);
  });

  it('干净音频：多数边界落在一帧内', () => {
    const all: number[] = [];
    for (const line of lines) all.push(...boundaryErrors(line).errors);
    const within = all.filter((e) => e <= FRAME_SECONDS * 1000).length / all.length;
    expect(within).toBeGreaterThan(0.7);
  });

  it('噪声音频（BGM+SFX）仍可对齐，平均误差受控', () => {
    const all: number[] = [];
    for (const line of lines) all.push(...boundaryErrors(line, true).errors);
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    // 强干扰下放宽到 120ms，但要求显著优于无锚点的秒级漂移。
    expect(mean).toBeLessThan(120);
  });

  it('不同配音 profile（方言/重录）均能完成对齐', () => {
    const text = '师傅，请问火车站怎么走？';
    for (const profile of [VOICE_PROFILES.dialect, VOICE_PROFILES.female, VOICE_PROFILES.retake]) {
      const parsed = parseLine(text);
      const synth = synthesizeLine(parsed.syllables, { profile, seed: 11 });
      const { timed } = alignPhonemes(synth.audio, parsed.phonemes, parsed.syllables);
      expect(timed.length).toBe(parsed.phonemes.length);
    }
  });
});
