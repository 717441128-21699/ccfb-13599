import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav, extractFeatures, FFT, resample } from '../src/core/audio.ts';
import { synthesizeLine } from '../src/core/synth.ts';
import { parseLine } from '../src/core/pinyin.ts';

describe('WAV 编解码', () => {
  it('编码后解码保持波形一致（16bit 量化误差内）', () => {
    const buf = {
      samples: Float32Array.from({ length: 8000 }, (_, i) =>
        Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5),
      sampleRate: 16000,
    };
    const bytes = encodeWav(buf);
    const back = decodeWav(bytes);
    expect(back.sampleRate).toBe(16000);
    expect(back.samples.length).toBe(buf.samples.length);
    let maxErr = 0;
    for (let i = 0; i < buf.samples.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(back.samples[i] - buf.samples[i]));
    }
    expect(maxErr).toBeLessThan(1 / 32768 + 1e-4);
  });

  it('拒绝非 WAV 数据', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe('FFT', () => {
  it('正确计算单频正弦的频谱峰', () => {
    const n = 512;
    const fft = new FFT(n);
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const bin = 8;
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * bin * i) / n);
    fft.run(re, im);
    let peak = 0; let peakMag = -1;
    for (let k = 0; k < n / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (m > peakMag) { peakMag = m; peak = k; }
    }
    expect(peak).toBe(bin);
  });
});

describe('特征提取与 VAD', () => {
  it('合成语音能切出非空特征且检出语音段', () => {
    const parsed = parseLine('你好，欢迎来到我们的游戏世界。');
    const { audio } = synthesizeLine(parsed.syllables, { seed: 7 });
    const f = extractFeatures(audio);
    expect(f.count).toBeGreaterThan(100);
    const voicedRatio = f.voiced.reduce((a, b) => a + b, 0) / f.count;
    expect(voicedRatio).toBeGreaterThan(0.3);
    expect(f.rms.length).toBe(f.count);
    expect(f.magnitude.length).toBe(f.count);
  });

  it('纯静音音频 VAD 语音占比极低', () => {
    const audio = {
      samples: new Float32Array(16000).fill(0.0001),
      sampleRate: 16000,
    };
    const f = extractFeatures(audio);
    const ratio = f.voiced.reduce((a, b) => a + b, 0) / f.count;
    expect(ratio).toBeLessThan(0.15);
  });
});

describe('重采样', () => {
  it('长度按采样率比例变化', () => {
    const src = {
      samples: Float32Array.from({ length: 48000 }, (_, i) =>
        Math.sin((2 * Math.PI * 100 * i) / 48000)),
      sampleRate: 48000,
    };
    const out = resample(src, 16000);
    expect(out.sampleRate).toBe(16000);
    expect(Math.abs(out.samples.length - 16000)).toBeLessThan(5);
  });
});
