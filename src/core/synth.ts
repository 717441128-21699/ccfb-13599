/**
 * 纯 TS 共振峰（formant）语音合成器 —— 自己生成配音样本。
 *
 * 思路：声门源（浊音脉冲串/清音白噪声）→ 每元音一组 F1/F2/F3 串联双二阶
 * 谐振 → 音节幅度包络与声调基频曲线 → 音素间交叉过渡（协同发音）。
 * 同时返回每个音素的精确采样边界，作为强制对齐的 ground truth。
 *
 * 另提供背景音乐/音效混合器，用于验证嘈杂配音下的对齐鲁棒性。
 */
import { decodeReading } from './pinyin';
import type {
  AudioBufferLike, Final, Initial, PinyinSyllable,
} from './types';
import { FRAME_SECONDS, SAMPLE_RATE } from './types';

/* ---------------- 双二阶滤波器 ---------------- */

class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0;
  private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;

  /** 谐振器（r = 阻尼，越接近 1 峰越尖）。 */
  resonance(freq: number, q: number, sr: number): void {
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cosw = Math.cos(w);
    const norm = 1 + alpha;
    this.b0 = alpha / norm;
    this.b1 = 0;
    this.b2 = -alpha / norm;
    this.a1 = (-2 * cosw) / norm;
    this.a2 = (1 - alpha) / norm;
  }

  /** 低通（噪声辅音塑形用）。 */
  lowpass(freq: number, q: number, sr: number): void {
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cosw = Math.cos(w);
    const norm = 1 + alpha;
    this.b0 = (1 - cosw) / 2 / norm;
    this.b1 = (1 - cosw) / norm;
    this.b2 = this.b0;
    this.a1 = (-2 * cosw) / norm;
    this.a2 = (1 - alpha) / norm;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
      - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/* ---------------- 元音共振峰表（Hz，成年男声基准，按 profile 缩放） ---------------- */

interface VowelFormants { f1: number; f2: number; f3: number; }

const VOWEL_FORMANTS: Record<string, VowelFormants> = {
  a: { f1: 730, f2: 1090, f3: 2440 },
  o: { f1: 570, f2: 840, f3: 2410 },
  e: { f1: 530, f2: 1840, f3: 2480 },
  i: { f1: 270, f2: 2290, f3: 3010 },
  u: { f1: 300, f2: 870, f3: 2240 },
  ü: { f1: 300, f2: 1700, f3: 2200 },
  er: { f1: 490, f2: 1350, f3: 1690 },
};

/** 复合韵母取主元音（响度峰所在）。 */
function nucleusOf(final: Final): keyof typeof VOWEL_FORMANTS {
  if (final === 'er') return 'er';
  if (final.includes('ü')) return 'ü';
  if (/^[iu]/.test(final) && final.length > 1) {
    // ia/ie/iao/ua/uo... 取韵腹
    if (final.includes('a')) return 'a';
    if (final.includes('e')) return 'e';
    if (final.includes('o') || final.includes('u')) return 'u';
    return 'i';
  }
  if (final.startsWith('i')) return 'i';
  if (final.startsWith('u')) return 'u';
  if (final === 'ai' || final === 'ao' || final === 'an' || final === 'ang') return 'a';
  if (final === 'ei' || final === 'en' || final === 'eng') return 'e';
  if (final === 'ou' || final === 'ong') return 'o';
  return final[0] as keyof typeof VOWEL_FORMANTS;
}

/* ---------------- 声调基频曲线 ---------------- */

const TONE_F0: Record<number, { base: number; contour: (u: number) => number }> = {
  1: { base: 165, contour: () => 1.0 },
  2: { base: 135, contour: (u) => 0.85 + 0.3 * u },
  3: { base: 120, contour: (u) => 0.9 - 0.25 * Math.sin(Math.PI * u) + 0.1 * u },
  4: { base: 175, contour: (u) => 1.1 - 0.45 * u },
  0: { base: 115, contour: (u) => 0.85 - 0.1 * u }, // 轻声：短、低、平
};

export interface VoiceProfile {
  id: string;
  /** 共振峰频率缩放（女声明亮、男声低沉、方言变体）。 */
  formantScale: number;
  /** 全局时长缩放（语速）。 */
  rateScale: number;
  /** 基频偏移倍率。 */
  f0Scale: number;
  /** 音色抖动（方言/重录的差异来源）。 */
  breathiness: number;
}

export const VOICE_PROFILES: Record<string, VoiceProfile> = {
  male: { id: 'male', formantScale: 1, rateScale: 1, f0Scale: 1, breathiness: 0.08 },
  female: { id: 'female', formantScale: 1.18, rateScale: 1.02, f0Scale: 1.55, breathiness: 0.05 },
  /** 方言变体：整体慢一点、鼻化更重、基频曲线压缩。 */
  dialect: { id: 'dialect', formantScale: 0.94, rateScale: 1.12, f0Scale: 0.92, breathiness: 0.18 },
  /** 重录版：语速略快。 */
  retake: { id: 'retake', formantScale: 1.02, rateScale: 0.92, f0Scale: 1.05, breathiness: 0.1 },
};

/* ---------------- 合成主流程 ---------------- */

export interface SynthOptions {
  profile?: VoiceProfile;
  /** 句首静音（秒）。 */
  leadSilence?: number;
  /** 随机种子（可复现）。 */
  seed?: number;
}

export interface GroundTruthBoundary {
  /** 对应音素在句中的序号（与 parseLine 的 phoneme.index 对齐）。 */
  phonemeIndex: number;
  start: number;
  end: number;
  label: string;
}

export interface SynthResult {
  audio: AudioBufferLike;
  boundaries: GroundTruthBoundary[];
  /** 实际音节时间（秒），调试用。 */
  syllableTimes: { char: string; start: number; end: number }[];
}

/** 可复现的伪随机数。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 单个音素的发音时长（秒），与 pinyin.ts 的先验保持同一量级但带随机抖动。 */
function phonemeDuration(
  kind: string, label: string, neutral: boolean, rnd: () => number, rate: number,
): number {
  let d: number;
  if (kind === 'initial') {
    if ('bpdtgk'.includes(label)) d = 0.075;
    else if ('fhsxshr'.includes(label)) d = 0.12;
    else if ('ccq'.includes(label)) d = 0.13;
    else if ('zzhj'.includes(label)) d = 0.11;
    else d = 0.095;
  } else if (kind === 'vowel') {
    d = neutral ? 0.12 : 0.18;
  } else if (kind === 'nasal-coda') {
    d = neutral ? 0.05 : 0.08;
  } else {
    d = 0.08; // er-cap
  }
  return d * rate * (0.9 + rnd() * 0.2);
}

export function synthesizeLine(
  syllables: PinyinSyllable[], options: SynthOptions = {},
): SynthResult {
  const profile = options.profile ?? VOICE_PROFILES.male;
  const rnd = mulberry32(options.seed ?? 42);
  const sr = SAMPLE_RATE;
  const lead = options.leadSilence ?? 0.25 + rnd() * 0.15;

  // 先算时间排程。
  interface Unit {
    syl: PinyinSyllable;
    parts: { kind: string; label: string; dur: number; phonemeIndex: number }[];
    start: number;
  }
  const units: Unit[] = [];
  const boundaries: GroundTruthBoundary[] = [];
  const syllableTimes: SynthResult['syllableTimes'] = [];
  let cursor = lead;
  let phonemeCounter = 0;

  for (const syl of syllables) {
    if (syl.isPause) {
      cursor += syl.pauseSeconds ?? 0.2;
      continue;
    }
    const parts: Unit['parts'] = [];
    if (syl.initial) {
      const d = phonemeDuration('initial', syl.initial, syl.neutral, rnd, profile.rateScale);
      parts.push({ kind: 'initial', label: syl.initial, dur: d, phonemeIndex: phonemeCounter++ });
    }
    if (syl.final) {
      const d = phonemeDuration('vowel', syl.final, syl.neutral, rnd, profile.rateScale);
      parts.push({ kind: 'vowel', label: syl.final, dur: d, phonemeIndex: phonemeCounter++ });
      const coda = syl.final.endsWith('ng') ? 'ng'
        : syl.final.endsWith('n') ? 'n' : null;
      if (coda) {
        parts.push({
          kind: 'nasal-coda', label: coda,
          dur: phonemeDuration('nasal-coda', coda, syl.neutral, rnd, profile.rateScale),
          phonemeIndex: phonemeCounter++,
        });
      }
      if (syl.erhua) {
        parts.push({
          kind: 'er-cap', label: 'er',
          dur: phonemeDuration('er-cap', 'er', syl.neutral, rnd, profile.rateScale),
          phonemeIndex: phonemeCounter++,
        });
      }
    }
    const start = cursor;
    for (const p of parts) {
      boundaries.push({
        phonemeIndex: p.phonemeIndex, start: cursor, end: cursor + p.dur, label: p.label,
      });
      cursor += p.dur;
    }
    syllableTimes.push({ char: syl.char, start, end: cursor });
    units.push({ syl, parts, start });
    // 字间微小间隙（非停顿），模拟自然断字。
    cursor += 0.015 + rnd() * 0.02;
  }

  const total = cursor + 0.3;
  const samples = new Float32Array(Math.ceil(total * sr));
  // 三个共振峰用并联结构（串联会逐级吞能量，导致元音 RMS 异常偏低）。
  const f1f = new Biquad(); const f2f = new Biquad(); const f3f = new Biquad();
  const noiseFilter = new Biquad();

  let noiseState = 0;
  const whiteNoise = (): number => {
    noiseState = (noiseState * 1103515245 + 12345) & 0x7fffffff;
    return noiseState / 0x3fffffff - 1;
  };

  for (const unit of units) {
    const { syl, parts } = unit;
    const tone = TONE_F0[syl.tone] ?? TONE_F0[0];
    const sylStartSample = Math.round(unit.start * sr);
    const sylDur = parts.reduce((a, p) => a + p.dur, 0);
    const sylEndSample = sylStartSample + Math.round(sylDur * sr);

    // 每个音节重置谐振器状态，避免跨音节状态串音。
    f1f.reset(); f2f.reset(); f3f.reset(); noiseFilter.reset();

    for (let n = sylStartSample; n < sylEndSample; n++) {
      const t = n / sr;
      const u = (n - sylStartSample) / Math.max(1, sylEndSample - sylStartSample);
      // 基频
      const f0 = tone.base * profile.f0Scale * tone.contour(u);
      // 声门源：每 1/f0 一个脉冲 + 噪声成分（breathiness）
      const phase = (t * f0) % 1;
      const glottal = phase < 0.12 ? Math.sin((phase / 0.12) * Math.PI) : 0;
      const noise = whiteNoise() * profile.breathiness;
      const source = glottal + noise * 0.3;

      // 幅度包络：字内平滑起振/收音
      const attack = Math.min(1, u / 0.12);
      const release = Math.min(1, (1 - u) / 0.18);
      const amp = 0.9 * Math.min(attack, release) * (syl.neutral ? 0.75 : 1);

      // 共振峰（主元音），儿化段把 F3 压低做卷舌感。并联加权求和，
      // F1 能量最大（响度主因），F2/F3 递减，保证元音 RMS 高于辅音。
      const nucleus = syl.final ? nucleusOf(syl.final) : 'e';
      const formants = VOWEL_FORMANTS[nucleus];
      const inErCap = isInPart(parts, t, unit.start, 'er-cap');
      const f3 = inErCap ? 1700 : formants.f3;
      f1f.resonance(formants.f1 * profile.formantScale, 6, sr);
      f2f.resonance(formants.f2 * profile.formantScale, 9, sr);
      f3f.resonance(f3 * profile.formantScale, 11, sr);
      const voicedVowel =
        f1f.step(source) * 1.0 + f2f.step(source) * 0.45 + f3f.step(source) * 0.2;
      let voiced = voicedVowel;

      // 声母覆盖：在声母区间替换为对应辅音源
      const initialPart = parts.find((p) => p.kind === 'initial');
      if (initialPart && t >= unit.start && t < unit.start + initialPart.dur) {
        voiced = renderConsonant(
          initialPart.label as Initial, source, whiteNoise, noiseFilter, sr,
        );
      }
      // 鼻韵尾：低通 + 轻鼻音
      const nasalPart = parts.find((p) => p.kind === 'nasal-coda');
      if (nasalPart) {
        const nasalStart = partStart(parts, unit.start, nasalPart);
        if (t >= nasalStart && t < nasalStart + nasalPart.dur) {
          noiseFilter.lowpass(900 * profile.formantScale, 2, sr);
          voiced = noiseFilter.step(source * 0.7 + whiteNoise() * 0.2);
        }
      }
      samples[n] += voiced * amp * 0.9;
    }
  }

  // 防止削波
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  if (peak > 0.95) {
    const g = 0.95 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= g;
  }
  return {
    audio: { samples, sampleRate: sr },
    boundaries,
    syllableTimes,
  };
}

function partStart(
  parts: { kind: string; dur: number }[], unitStart: number,
  target: { kind: string; dur: number },
): number {
  let t = unitStart;
  for (const p of parts) {
    if (p === target) return t;
    t += p.dur;
  }
  return unitStart;
}

function isInPart(
  parts: { kind: string; dur: number }[], t: number, unitStart: number, kind: string,
): boolean {
  let cursor = unitStart;
  for (const p of parts) {
    if (p.kind === kind && t >= cursor && t < cursor + p.dur) return true;
    cursor += p.dur;
  }
  return false;
}

/** 辅音渲染：塞音=脉冲+短噪，擦音=滤波噪声，鼻音/边音保留浊音源。
 *  整体增益低于元音，保证「元音是响度峰」这一语音学结构成立。 */
function renderConsonant(
  label: Initial, glottal: number, noise: () => number, filter: Biquad, sr: number,
): number {
  if ('bpdtgk'.includes(label)) {
    filter.lowpass(2400, 1, sr);
    return filter.step(noise()) * 0.4;
  }
  if (label === 'f' || label === 'h' || label === 's' || label === 'sh'
    || label === 'x' || label === 'r') {
    filter.lowpass(
      label === 's' || label === 'x' || label === 'sh' ? 5200 : 3200, 0.7, sr,
    );
    return filter.step(noise()) * 0.35;
  }
  if (label === 'z' || label === 'c' || label === 'zh' || label === 'ch'
    || label === 'j' || label === 'q') {
    filter.lowpass(4200, 1, sr);
    return filter.step(noise()) * 0.38;
  }
  // m / n / l：浊辅音，保留声门脉冲能量（低通柔化），VAD/浊音特征连续。
  filter.lowpass(1400, 1.2, sr);
  return filter.step(glottal * 0.7 + noise() * 0.06);
}

/* ---------------- 背景音乐 / 音效混合 ---------------- */

export interface MixOptions {
  /** 背景音乐增益（相对人声）。 */
  bgmGain?: number;
  /** 音效（短促噪声事件）出现次数。 */
  sfxCount?: number;
  sfxGain?: number;
  seed?: number;
}

/** 生成一段平缓的背景音乐：两个低频正弦 + 慢颤音，能量集中在低频。 */
export function generateBgm(duration: number, sr: number, seed = 7): AudioBufferLike {
  const rnd = mulberry32(seed);
  const n = Math.round(duration * sr);
  const out = new Float32Array(n);
  const fA = 110 + rnd() * 40;
  const fB = 164 + rnd() * 30;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const tremolo = 0.7 + 0.3 * Math.sin(2 * Math.PI * 1.5 * t);
    out[i] = tremolo * (
      Math.sin(2 * Math.PI * fA * t) * 0.5
      + Math.sin(2 * Math.PI * fB * t) * 0.35
    );
  }
  return { samples: out, sampleRate: sr };
}

/** 生成若干音效事件（短促宽带噪声爆发，模拟打斗/提示音）。 */
export function generateSfx(
  duration: number, sr: number, count: number, seed = 11,
): AudioBufferLike {
  const rnd = mulberry32(seed);
  const out = new Float32Array(Math.round(duration * sr));
  for (let k = 0; k < count; k++) {
    const start = Math.round(rnd() * duration * sr);
    const len = Math.round((0.08 + rnd() * 0.15) * sr);
    const freq = 600 + rnd() * 1800;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const u = i / len;
      const env = Math.sin(Math.PI * u);
      out[start + i] += env * (
        Math.sin(2 * Math.PI * freq * (i / sr)) * 0.6
        + (rnd() - 0.5) * 0.4
      );
    }
  }
  return { samples: out, sampleRate: sr };
}

export function mixWithBed(
  voice: AudioBufferLike, opts: MixOptions = {},
): AudioBufferLike {
  const sr = voice.sampleRate;
  const duration = voice.samples.length / sr;
  const rnd = mulberry32(opts.seed ?? 99);
  const bgm = generateBgm(duration, sr, Math.floor(rnd() * 1e6));
  const sfx = generateSfx(duration, sr, opts.sfxCount ?? 3, Math.floor(rnd() * 1e6));
  const gBgm = opts.bgmGain ?? 0.18;
  const gSfx = opts.sfxGain ?? 0.25;
  const out = new Float32Array(voice.samples.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = voice.samples[i] + bgm.samples[i] * gBgm + sfx.samples[i] * gSfx;
  }
  // 限幅，防止削波
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  if (peak > 0.98) {
    const g = 0.98 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
  return { samples: out, sampleRate: sr };
}

/** 供测试/调试：直接由编码读音构造一个音节。 */
export function syllableFromCode(
  char: string, code: string,
): PinyinSyllable {
  const r = decodeReading(code);
  return {
    char, initial: r.initial, final: r.final, tone: r.tone,
    erhua: false, neutral: r.tone === 0, isPause: false,
  };
}

export { FRAME_SECONDS };
