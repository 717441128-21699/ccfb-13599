import { describe, expect, it } from 'vitest';
import { audioHash, needsRecompute, runPipeline } from '../src/core/pipeline.ts';
import { parseLine } from '../src/core/pinyin.ts';
import { mixWithBed, synthesizeLine, VOICE_PROFILES } from '../src/core/synth.ts';
import { SAMPLE_LINES } from '../src/core/samples.ts';

describe('端到端流水线', () => {
  it('文本 + 音频产出完整 LipSyncClip', () => {
    const text = '你好，欢迎来到我们的游戏世界。';
    const parsed = parseLine(text);
    const { audio } = synthesizeLine(parsed.syllables, { seed: 7 });
    const { clip, warnings } = runPipeline(text, audio, { id: 'c1' });
    expect(clip.id).toBe('c1');
    expect(clip.text).toBe(text);
    expect(clip.phonemes.length).toBeGreaterThan(0);
    expect(clip.frames.length).toBeGreaterThan(0);
    expect(clip.keys.length).toBeGreaterThan(0);
    expect(clip.meta.sampleRate).toBe(16000);
    expect(clip.meta.frameRate).toBe(30);
    expect(clip.meta.audioHash).toMatch(/^[0-9a-f]{16}$/);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('音频指纹对相同内容稳定、对不同内容敏感', () => {
    const a = synthesizeLine(parseLine('你好。').syllables, { seed: 1 }).audio;
    const b = synthesizeLine(parseLine('你好。').syllables, { seed: 1 }).audio;
    const c = synthesizeLine(parseLine('站住！').syllables, { seed: 1 }).audio;
    expect(audioHash(a)).toBe(audioHash(b));
    expect(audioHash(a)).not.toBe(audioHash(c));
  });

  it('换配音（音频变化）触发重算，相同音频不重算', () => {
    const text = '今天天气真好。';
    const parsed = parseLine(text);
    const a = synthesizeLine(parsed.syllables, { profile: VOICE_PROFILES.male, seed: 3 }).audio;
    const b = synthesizeLine(parsed.syllables, { profile: VOICE_PROFILES.dialect, seed: 3 }).audio;
    const { clip } = runPipeline(text, a, { voiceProfile: 'male' });
    expect(needsRecompute(clip, a, 'male')).toBe(false);
    expect(needsRecompute(clip, b, 'male')).toBe(true);
    expect(needsRecompute(clip, a, 'dialect')).toBe(true);
  });

  it('全部样本台词都能跑通且无未登录字告警', () => {
    for (const line of SAMPLE_LINES) {
      const parsed = parseLine(line.text);
      const { audio } = synthesizeLine(parsed.syllables, { seed: 5 });
      const { clip, warnings } = runPipeline(line.text, audio, { id: line.id });
      expect(clip.frames.length).toBeGreaterThan(0);
      const unknownWarn = warnings.some((w) => w.includes('未登录字'));
      expect(unknownWarn).toBe(false);
    }
  });
});

describe('合成器', () => {
  it('产出 16k 单声道音频与等长真值边界', () => {
    const parsed = parseLine('他吃了一碗面条。');
    const r = synthesizeLine(parsed.syllables, { seed: 2 });
    expect(r.audio.sampleRate).toBe(16000);
    expect(r.audio.samples.length).toBeGreaterThan(16000 * 0.5);
    expect(r.boundaries.length).toBe(parsed.phonemes.length);
    // 边界单调
    for (let i = 1; i < r.boundaries.length; i++) {
      expect(r.boundaries[i].start).toBeGreaterThanOrEqual(r.boundaries[i - 1].end - 1e-6);
    }
    // 无削波
    let peak = 0;
    for (const x of r.audio.samples) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('混合 BGM/SFX 后长度不变且无削波', () => {
    const parsed = parseLine('今天天气真好。');
    const { audio } = synthesizeLine(parsed.syllables, { seed: 4 });
    const out = mixWithBed(audio, { bgmGain: 0.2, sfxCount: 3 });
    expect(out.samples.length).toBe(audio.samples.length);
    let peak = 0;
    for (const x of out.samples) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeLessThanOrEqual(1);
  });
});
