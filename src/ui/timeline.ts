/**
 * 时间线编辑器：波形 + 14 路口型曲线 + 可拖拽关键帧。
 * 纯 Canvas 2D 绘制；拖拽关键帧后回调更新，吸附到 30fps 帧网格。
 */
import { ALL_VISEMES, FRAME_RATE, type LipSyncClip, type VisemeKey, type VisemeName } from '../core/types';
import { snapToFrame } from '../core/curve';

export interface EditorCallbacks {
  /** 关键帧被拖动（frame/weight 修改）后回调。 */
  onKeysChange: (keys: VisemeKey[]) => void;
  /** 播放头移动回调。 */
  onScrub: (time: number) => void;
}

interface DragState {
  key: VisemeKey;
  viseme: VisemeName;
  pointerId: number;
}

const LANE_HEIGHT = 26;
const HEADER_WIDTH = 46;

export class TimelineEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private clip: LipSyncClip | null = null;
  private wave: number[] = [];
  private playhead = 0;
  private pxPerSecond = 120;
  private scrollX = 0;
  private drag: DragState | null = null;
  private cb: EditorCallbacks;
  /** 各口型轨道的显示开关与颜色。 */
  private colors = ['#e05260', '#f0a04b', '#5fb878', '#3aa6b9', '#5e8dd6', '#8b6fd0', '#d06fb0'];

  constructor(canvas: HTMLCanvasElement, cb: EditorCallbacks) {
    this.canvas = canvas;
    this.ctx = createRetina(canvas);
    this.cb = cb;
    this.bind();
  }

  setClip(clip: LipSyncClip, wave: number[]): void {
    this.clip = clip;
    this.wave = wave;
    this.playhead = 0;
    this.scrollX = 0;
    this.fitZoom();
    this.draw();
  }

  setPlayhead(t: number): void {
    this.playhead = t;
    this.draw();
  }

  get duration(): number {
    return this.clip?.duration ?? 0;
  }

  /** 根据时长自适应缩放，使整条时间线可见。 */
  private fitZoom(): void {
    if (!this.clip) return;
    const width = this.canvas.clientWidth - HEADER_WIDTH;
    this.pxPerSecond = Math.max(40, width / Math.max(1, this.clip.duration));
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.pxPerSecond = THREE_clamp(this.pxPerSecond * factor, 30, 800);
    this.draw();
  };

  private timeToX(t: number): number {
    return HEADER_WIDTH + t * this.pxPerSecond - this.scrollX;
  }

  private xToTime(x: number): number {
    return (x + this.scrollX - HEADER_WIDTH) / this.pxPerSecond;
  }

  private laneTop(v: number): number {
    return 40 + v * LANE_HEIGHT; // 顶部 40px 留给波形
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.clip) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // 波形/空白区：拖动播放头。
    if (y < 38) {
      this.seekTo(x);
      return;
    }
    const v = Math.floor((y - 40) / LANE_HEIGHT);
    if (v < 0 || v >= ALL_VISEMES.length) return;
    const viseme = ALL_VISEMES[v];
    const hit = this.findKeyAt(viseme, x, y);
    if (hit) {
      this.drag = { key: hit, viseme, pointerId: e.pointerId };
      this.canvas.setPointerCapture(e.pointerId);
    } else {
      // 空白处点击也移动播放头。
      this.seekTo(x);
    }
  };

  private seekTo(x: number): void {
    const t = THREE_clamp(this.xToTime(x), 0, this.duration);
    this.playhead = t;
    this.cb.onScrub(t);
    this.draw();
  }

  private findKeyAt(viseme: VisemeName, x: number, y: number): VisemeKey | null {
    if (!this.clip) return null;
    const vIdx = ALL_VISEMES.indexOf(viseme);
    const top = this.laneTop(vIdx);
    let best: VisemeKey | null = null;
    let bestDist = 8;
    for (const k of this.clip.keys) {
      if (k.viseme !== viseme) continue;
      const kx = this.timeToX(k.frame / FRAME_RATE);
      const ky = top + LANE_HEIGHT - 4 - k.weight * (LANE_HEIGHT - 8);
      const d = Math.hypot(kx - x, ky - y);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    return best;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag || !this.clip) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const vIdx = ALL_VISEMES.indexOf(this.drag.viseme);
    const top = this.laneTop(vIdx);
    // 横向改时间（吸附帧网格），纵向改权重。
    const t = THREE_clamp(this.xToTime(x), 0, this.duration);
    this.drag.key.frame = snapToFrame(t);
    const heightRatio = THREE_clamp(1 - (y - top - 4) / (LANE_HEIGHT - 8), 0, 1);
    this.drag.key.weight = Math.round(heightRatio * 100) / 100;
    this.cb.onKeysChange(this.clip.keys);
    this.draw();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.drag) {
      try { this.canvas.releasePointerCapture(this.drag.pointerId); } catch { /* ignore */ }
      this.drag = null;
      void e;
    }
  };

  /** 主绘制。 */
  draw(): void {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#16181d';
    ctx.fillRect(0, 0, w, h);
    if (!this.clip) return;

    this.drawWaveform(w);
    this.drawGrid(w, h);
    this.drawLanes(w, h);
    this.drawPlayhead(w, h);
  }

  private drawWaveform(width: number): void {
    const { ctx } = this;
    const top = 4;
    const h = 32;
    ctx.fillStyle = '#1d2026';
    ctx.fillRect(HEADER_WIDTH, top, width - HEADER_WIDTH, h);
    if (!this.wave.length) return;
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const visibleSamples = Math.floor(this.duration * this.pxPerSecond);
    for (let x = HEADER_WIDTH; x < width; x++) {
      const t = this.xToTime(x);
      const idx = Math.floor(t * (this.wave.length / Math.max(0.001, this.duration)));
      const amp = this.wave[THREE_clamp(idx, 0, this.wave.length - 1)] ?? 0;
      const yMid = top + h / 2;
      const yAmp = amp * (h / 2 - 2);
      ctx.moveTo(x, yMid - yAmp);
      ctx.lineTo(x, yMid + yAmp);
    }
    ctx.stroke();
    void visibleSamples;
  }

  private drawGrid(width: number, height: number): void {
    const { ctx } = this;
    ctx.strokeStyle = '#262a32';
    ctx.lineWidth = 1;
    // 每秒一条竖线 + 帧刻度。
    for (let t = 0; t <= this.duration; t += 0.5) {
      const x = this.timeToX(t);
      if (x < HEADER_WIDTH || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (Math.abs(t - Math.round(t)) < 0.01) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px monospace';
        ctx.fillText(`${t}s`, x + 2, 12);
      }
    }
  }

  private drawLanes(width: number, height: number): void {
    const { ctx } = this;
    ALL_VISEMES.forEach((viseme, v) => {
      const top = this.laneTop(v);
      // 轨道背景与标签。
      ctx.fillStyle = v % 2 ? '#181b21' : '#15171c';
      ctx.fillRect(0, top, width, LANE_HEIGHT);
      ctx.fillStyle = '#9aa4b2';
      ctx.font = '10px monospace';
      ctx.fillText(viseme, 4, top + LANE_HEIGHT / 2 + 3);
      ctx.strokeStyle = '#2a2f38';
      ctx.beginPath();
      ctx.moveTo(HEADER_WIDTH, top);
      ctx.lineTo(width, top);
      ctx.stroke();

      // 该口型的曲线（在关键帧间连线）。
      const keys = this.clip!.keys
        .filter((k) => k.viseme === viseme)
        .sort((a, b) => a.frame - b.frame);
      if (keys.length) {
        ctx.strokeStyle = this.colors[v % this.colors.length];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        keys.forEach((k, i) => {
          const x = this.timeToX(k.frame / FRAME_RATE);
          const y = top + LANE_HEIGHT - 4 - k.weight * (LANE_HEIGHT - 8);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        // 关键帧菱形。
        for (const k of keys) {
          const x = this.timeToX(k.frame / FRAME_RATE);
          const y = top + LANE_HEIGHT - 4 - k.weight * (LANE_HEIGHT - 8);
          ctx.fillStyle = this.colors[v % this.colors.length];
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-3, -3, 6, 6);
          ctx.restore();
        }
      }
    });
    void height;
  }

  private drawPlayhead(width: number, height: number): void {
    const { ctx } = this;
    const x = this.timeToX(this.playhead);
    if (x < HEADER_WIDTH || x > width) return;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

/* —— 小工具（避免在 UI 文件引入 three 的 MathUtils）—— */
function THREE_clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function createRetina(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const resize = (): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  return canvas.getContext('2d')!;
}
