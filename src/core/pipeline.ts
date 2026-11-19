/**
 * 端到端流水线：文本 + 音频 → LipSyncClip。
 * 纯函数、确定性输出；浏览器 UI 与 Node 批量 CLI 共用。
 */
import { alignPhonemes } from './alignment';
import { resample } from './audio';
import { assembleClip } from './curve';
import { parseLine } from './pinyin';
import type {
  AudioBufferLike, ClipMeta, LipSyncClip,
} from './types';
import { FRAME_RATE, SAMPLE_RATE } from './types';

/** 音频内容指纹：PCM 分块均值哈希，换配音/重录必然变化。 */
export function audioHash(buffer: AudioBufferLike): string {
  const x = buffer.samples;
  const blocks = 64;
  const size = Math.max(1, Math.floor(x.length / blocks));
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let b = 0; b < blocks; b++) {
    let sum = 0;
    const lo = b * size;
    const hi = Math.min(x.length, lo + size);
    for (let i = lo; i < hi; i++) sum += Math.abs(x[i]);
    const v = Math.round((sum / Math.max(1, hi - lo)) * 1e6);
    h1 = Math.imul(h1 ^ v, 2654435761);
    h2 = Math.imul(h2 ^ (v + 0x9e3779b9), 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

export interface PipelineOptions {
  id?: string;
  pinyinOverride?: string;
  voiceProfile?: string;
}

export interface PipelineResult {
  clip: LipSyncClip;
  unknownChars: string[];
  warnings: string[];
}

export function runPipeline(
  text: string,
  input: AudioBufferLike,
  opts: PipelineOptions = {},
): PipelineResult {
  const warnings: string[] = [];
  const audio = input.sampleRate === SAMPLE_RATE
    ? input
    : resample(input, SAMPLE_RATE);

  const parsed = parseLine(text, opts.pinyinOverride);
  if (parsed.unknownChars.length) {
    warnings.push(`未登录字（已用占位读音，请扩展词典或提供拼音覆盖）：${
      parsed.unknownChars.join('、')}`);
  }
  if (parsed.phonemes.length === 0) {
    throw new Error('文本中没有可发音的汉字');
  }

  const duration = audio.samples.length / audio.sampleRate;
  const alignment = alignPhonemes(audio, parsed.phonemes, parsed.syllables);

  const meta: ClipMeta = {
    sampleRate: SAMPLE_RATE,
    frameRate: FRAME_RATE,
    alignmentScore: Math.round(alignment.score * 1000) / 1000,
    audioHash: audioHash(audio),
    voiceProfile: opts.voiceProfile ?? 'default',
    createdAt: new Date(0).toISOString(), // 由调用方覆盖，保证确定性测试
  };
  const clip = assembleClip(
    opts.id ?? `clip-${meta.audioHash.slice(0, 8)}`,
    text, duration, parsed.syllables, alignment.timed, meta,
  );
  return { clip, unknownChars: parsed.unknownChars, warnings };
}

/**
 * 重算判定：音频指纹或配音 profile 变化即重新对齐。
 * 编辑器手动关键帧按「音节序号 + 口型名」为键保存，可在重算后重新挂载。
 */
export function needsRecompute(
  clip: LipSyncClip, audio: AudioBufferLike, voiceProfile: string,
): boolean {
  return clip.meta.audioHash !== audioHash(audio)
    || clip.meta.voiceProfile !== voiceProfile;
}

export function recompute(
  clip: LipSyncClip, audio: AudioBufferLike, voiceProfile?: string,
): PipelineResult {
  return runPipeline(clip.text, audio, {
    id: clip.id,
    voiceProfile: voiceProfile ?? clip.meta.voiceProfile,
  });
}
