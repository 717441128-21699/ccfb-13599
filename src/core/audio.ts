/**
 * 纯 TypeScript 音频 DSP：16bit PCM WAV 编解码、汉宁窗、基 2 FFT、
 * 分帧能量/过零率/频谱通量/频谱质心，以及带滞后门限的 VAD。
 * 不依赖 Web Audio，浏览器与 Node 结果完全一致。
 */
import type { AudioBufferLike } from './types';
import { HOP_SECONDS, SAMPLE_RATE, WINDOW_SECONDS } from './types';

/* ---------------- WAV 编解码 ---------------- */

export function encodeWav(buffer: AudioBufferLike): Uint8Array {
  const n = buffer.samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = n * bytesPerSample;
  const out = new Uint8Array(44 + dataSize);
  const dv = new DataView(out.buffer);
  writeAscii(dv, 0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  writeAscii(dv, 8, 'WAVE');
  writeAscii(dv, 12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // 单声道
  dv.setUint32(24, buffer.sampleRate, true);
  dv.setUint32(28, buffer.sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);
  writeAscii(dv, 36, 'data');
  dv.setUint32(40, dataSize, true);
  let p = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, buffer.samples[i]));
    dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    p += 2;
  }
  return out;
}

function writeAscii(dv: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
}

export function decodeWav(bytes: Uint8Array): AudioBufferLike {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(dv, 0, 4) !== 'RIFF' || ascii(dv, 8, 4) !== 'WAVE') {
    throw new Error('不是合法的 WAV 文件（缺少 RIFF/WAVE 头）');
  }
  let offset = 12;
  let sampleRate = 16000;
  let dataOffset = -1;
  let dataLen = 0;
  while (offset + 8 <= bytes.length) {
    const id = ascii(dv, offset, 4);
    const size = dv.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      const format = dv.getUint16(offset + 8, true);
      if (format !== 1) throw new Error(`仅支持 PCM WAV，遇到格式 ${format}`);
      const channels = dv.getUint16(offset + 10, true);
      if (channels !== 1) throw new Error('仅支持单声道 WAV');
      sampleRate = dv.getUint32(offset + 12, true);
      const bits = dv.getUint16(offset + 22, true);
      if (bits !== 16) throw new Error(`仅支持 16bit WAV，遇到 ${bits}bit`);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error('WAV 中没有 data 块');
  const n = Math.min(dataLen, bytes.length - dataOffset) >> 1;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = dv.getInt16(dataOffset + i * 2, true) / 0x8000;
  }
  return { samples, sampleRate };
}

function ascii(dv: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(offset + i));
  return s;
}

/* ---------------- FFT（迭代基 2） ---------------- */

export class FFT {
  readonly n: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    if ((n & (n - 1)) !== 0 || n < 2) throw new Error('FFT 长度必须是 2 的幂');
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((-2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
  }

  /** 就地计算，re/im 长度均为 n。 */
  run(re: Float32Array, im: Float32Array): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wre = cos[k * step];
          const wim = sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = wre * re[b] - wim * im[b];
          const ti = wre * im[b] + wim * re[b];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

/* ---------------- 分帧与特征 ---------------- */

export interface FrameFeatures {
  /** 帧数。 */
  count: number;
  hopSamples: number;
  windowSamples: number;
  /** 每帧 RMS 能量（线性）。 */
  rms: Float32Array;
  /** 过零率 0..1。 */
  zcr: Float32Array;
  /** 频谱通量（相邻帧频谱变化）。 */
  flux: Float32Array;
  /** 频谱质心（归一化频率 0..1）。 */
  centroid: Float32Array;
  /** 浊音后验 0..1（低过零率 + 低频能量占比）。 */
  voicing: Float32Array;
  /** VAD 判定。 */
  voiced: Uint8Array;
  /** 每帧幅度谱（count × n/2），对齐评分用。 */
  magnitude: Float32Array[];
  fftSize: number;
}

export function frameCount(samples: Float32Array, sampleRate: number): number {
  const hop = Math.round(sampleRate * HOP_SECONDS);
  const win = Math.round(sampleRate * WINDOW_SECONDS);
  if (samples.length < win) return 0;
  return 1 + Math.floor((samples.length - win) / hop);
}

export function extractFeatures(buffer: AudioBufferLike): FrameFeatures {
  const sr = buffer.sampleRate;
  const hop = Math.round(sr * HOP_SECONDS);
  const win = Math.round(sr * WINDOW_SECONDS);
  const fftSize = nextPow2(win);
  const count = buffer.samples.length < win
    ? 0
    : 1 + Math.floor((buffer.samples.length - win) / hop);

  const fft = new FFT(fftSize);
  const window = hannWindow(win);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  const rms = new Float32Array(count);
  const zcr = new Float32Array(count);
  const flux = new Float32Array(count);
  const centroid = new Float32Array(count);
  const voicing = new Float32Array(count);
  const voiced = new Uint8Array(count);
  const magnitude: Float32Array[] = new Array(count);
  let prevMag: Float32Array | null = null;

  for (let f = 0; f < count; f++) {
    const start = f * hop;
    let energy = 0;
    let crossings = 0;
    for (let i = 0; i < win; i++) {
      const x = buffer.samples[start + i] ?? 0;
      const wx = x * window[i];
      re[i] = wx;
      im[i] = 0;
      energy += x * x;
      if (i > 0) {
        const a = buffer.samples[start + i - 1];
        if ((a >= 0 && x < 0) || (a < 0 && x >= 0)) crossings++;
      }
    }
    for (let i = win; i < fftSize; i++) { re[i] = 0; im[i] = 0; }
    rms[f] = Math.sqrt(energy / win);
    zcr[f] = crossings / (win - 1);

    fft.run(re, im);
    const half = fftSize >> 1;
    const mag = new Float32Array(half);
    let weightedSum = 0;
    let magSum = 0;
    let lowEnergy = 0;
    for (let k = 0; k < half; k++) {
      const m = Math.hypot(re[k], im[k]);
      mag[k] = m;
      weightedSum += k * m;
      magSum += m;
      if (k < half * 0.12) lowEnergy += m;
    }
    magnitude[f] = mag;
    centroid[f] = magSum > 0 ? weightedSum / (magSum * half) : 0;
    const lowRatio = magSum > 0 ? lowEnergy / magSum : 0;
    // 浊音判定以低过零率为主（声门脉冲的硬性指标），低频能量占比为辅。
    // 不能让 lowRatio 主导：背景音乐是低频稳态乐音，lowRatio 同样很高，
    // 但它的过零率不会像浊音那样稳定走低。
    voicing[f] = clamp01(
      clamp01((0.4 - zcr[f]) / 0.4) * 0.65 + clamp01(lowRatio - 0.3) * 0.35,
    );

    if (prevMag) {
      let d = 0;
      for (let k = 0; k < half; k++) d += Math.max(0, mag[k] - prevMag[k]);
      flux[f] = d / half;
    }
    prevMag = mag;
  }

  runVAD(rms, zcr, voicing, flux, voiced);
  return {
    count, hopSamples: hop, windowSamples: win, rms, zcr, flux,
    centroid, voicing, voiced, magnitude, fftSize,
  };
}

/**
 * 带滞后门限的 VAD：
 * 噪声底由整段低分位估计；高开阈进入语音、低开阈退出，避免门限附近抖动。
 * 背景音乐/音效主要抬高噪声底，自适应门限保证语音段仍可被切出。
 */
function runVAD(
  rms: Float32Array, zcr: Float32Array, voicing: Float32Array,
  flux: Float32Array, out: Uint8Array,
): void {
  const n = rms.length;
  if (n === 0) return;
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(n * 0.2)] || 1e-4;
  const median = sorted[Math.floor(n * 0.5)] || floor;
  const highGate = Math.max(floor * 2.6, median * 0.42);
  const lowGate = Math.max(floor * 1.6, median * 0.3);
  // 频谱通量门限：背景音乐是稳态乐音、通量持续很低；语音（尤其声母、
  // 音素过渡）频谱快速变化。用通量中位数刻画底噪的稳态水平。
  const fluxSorted = Float32Array.from(flux).sort();
  const fluxFloor = fluxSorted[Math.floor(n * 0.5)] || 1e-6;
  const fluxGate = fluxFloor * 1.8;

  let state = 0;
  const hangover = 6;
  let downCount = 0;
  let steadyCount = 0; // 连续稳态 BGM 计数
  for (let f = 0; f < n; f++) {
    const gate = state ? lowGate : highGate;
    const energyHit = rms[f] > gate;
    const voicedHit = voicing[f] > 0.55 && zcr[f] < 0.32 && rms[f] > floor * 1.3;
    const dynamicHit = flux[f] > fluxGate && rms[f] > floor * 1.4;
    // 稳态 BGM 否决：低过零率 + 频谱几乎不变化，是持续乐音而非语音。
    // 通量门限放宽到 0.9 倍 gate、zcr 放宽到 0.12，覆盖 SFX 尾音回落段。
    const steadyBgm = flux[f] < fluxGate * 0.9 && zcr[f] < 0.12;
    if (steadyBgm) {
      steadyCount++;
    } else {
      // 允许偶发 1 帧打断（塞音持阻等），不完全清零。
      steadyCount = Math.max(0, steadyCount - 2);
    }
    // 语音必须有频谱动态（声母/过渡），纯能量或纯浊音不足以确认，
    // 但已在语音态内时放宽，避免元音稳定段被切断。
    const speechLike = state
      ? (energyHit || voicedHit) && !steadyBgm
      : (dynamicHit || ((energyHit || voicedHit) && !steadyBgm));
    if (speechLike) {
      state = 1;
      downCount = 0;
    } else if (state) {
      downCount++;
      // 累计 5 帧稳态 BGM（50ms）即退出，不等 hangover，
      // 防止句尾持续背景音乐/SFX 尾音把语音区间拉长。
      if (downCount > hangover || steadyCount >= 5) state = 0;
    }
    out[f] = state;
  }
  // 形态学闭运算：填补 ≤60ms 的短空隙（塞音持阻、被 BGM 掩盖的弱发音）。
  // 噪声下句内召回不足时，适当补洞比保留碎片更利于锚点映射；
  // 更长的停顿保留，交由 HMM 静音状态吸收。
  closeGaps(out, 6);
}

function closeGaps(v: Uint8Array, maxGap: number): void {
  let i = 0;
  while (i < v.length) {
    if (v[i] === 0) {
      const start = i;
      while (i < v.length && v[i] === 0) i++;
      const gap = i - start;
      if (start > 0 && i < v.length && gap <= maxGap) {
        for (let j = start; j < i; j++) v[j] = 1;
      }
    } else {
      i++;
    }
  }
}

export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

export function nextPow2(x: number): number {
  let p = 1;
  while (p < x) p <<= 1;
  return p;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 帧索引 → 秒（帧中心时间）。 */
export function frameToSeconds(frame: number, sr: number, hop: number): number {
  return (frame * hop + hop / 2) / sr;
}

export function secondsToFrame(t: number, sr: number, hop: number): number {
  return Math.round((t * sr - hop / 2) / hop);
}

/** 重采样到目标采样率（线性插值，用于外部 44.1k/48k 音频）。 */
export function resample(buffer: AudioBufferLike, targetRate: number): AudioBufferLike {
  if (buffer.sampleRate === targetRate) return buffer;
  const ratio = buffer.sampleRate / targetRate;
  const n = Math.floor(buffer.samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = buffer.samples[i0] ?? 0;
    const b = buffer.samples[i0 + 1] ?? a;
    out[i] = a * (1 - frac) + b * frac;
  }
  return { samples: out, sampleRate: targetRate };
}

export { SAMPLE_RATE };
