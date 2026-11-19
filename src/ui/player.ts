/**
 * Web Audio 播放器：把 16k PCM 重采样到浏览器采样率后播放，
 * 通过 requestAnimationFrame 轮询 AudioContext 时间驱动播放头。
 */
import type { AudioBufferLike } from '../core/types';

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private playing = false;
  private raf = 0;
  private onTime: (t: number) => void;
  private onEnded: () => void;

  constructor(onTime: (t: number) => void, onEnded: () => void) {
    this.onTime = onTime;
    this.onEnded = onEnded;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  /** 加载 PCM（内部采样率 16k，自动转浏览器采样率）。 */
  load(audio: AudioBufferLike): void {
    const ctx = this.ensureContext();
    const targetRate = ctx.sampleRate;
    const ratio = audio.sampleRate / targetRate;
    const n = Math.floor(audio.samples.length / ratio);
    const buf = ctx.createBuffer(1, n, targetRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = audio.samples[i0] ?? 0;
      const b = audio.samples[i0 + 1] ?? a;
      data[i] = a * (1 - frac) + b * frac;
    }
    this.buffer = buf;
    this.stop();
    this.offset = 0;
  }

  play(): void {
    if (!this.buffer || this.playing) return;
    const ctx = this.ensureContext();
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(ctx.destination);
    src.onended = (): void => {
      if (this.playing) {
        this.playing = false;
        this.offset = 0;
        this.onEnded();
      }
    };
    src.start(0, this.offset);
    this.source = src;
    this.startedAt = ctx.currentTime - this.offset;
    this.playing = true;
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime();
    this.stopSource();
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(t, this.buffer?.duration ?? 0));
    this.onTime(this.offset);
    if (wasPlaying) this.play();
  }

  private stop(): void {
    this.stopSource();
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  private stopSource(): void {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* ignore */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  private tick = (): void => {
    if (!this.playing) return;
    this.onTime(this.currentTime());
    this.raf = requestAnimationFrame(this.tick);
  };

  currentTime(): number {
    if (!this.ctx) return this.offset;
    return this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }
}
