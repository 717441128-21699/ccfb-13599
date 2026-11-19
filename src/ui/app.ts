/**
 * 应用主控制器：串联样本生成 → 对齐管线 → three.js 预览 →
 * 时间线编辑 → 播放，并处理配音切换的自动重算。
 */
import * as THREE from 'three';
import { alignPhonemes } from '../core/alignment';
import { decodeWav, encodeWav } from '../core/audio';
import { assembleClip, keysToFrames, rebuildFromKeys } from '../core/curve';
import { parseLine } from '../core/pinyin';
import { audioHash, needsRecompute, runPipeline } from '../core/pipeline';
import {
  mixWithBed, synthesizeLine, VOICE_PROFILES, type VoiceProfile,
} from '../core/synth';
import { SAMPLE_LINES } from '../core/samples';
import {
  ALL_VISEMES, FRAME_RATE, FRAME_SECONDS, type AudioBufferLike,
  type LipSyncClip, type VisemeKey,
} from '../core/types';
import { createHead, type Rig } from './head';
import { AudioPlayer } from './player';
import { TimelineEditor } from './timeline';

interface CurrentLine {
  text: string;
  audio: AudioBufferLike;
  clip: LipSyncClip;
  profileId: string;
  noisy: boolean;
}

export class App {
  private threeCanvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private rig: Rig;
  private player: AudioPlayer;
  private editor: TimelineEditor;
  private current: CurrentLine | null = null;
  private raf = 0;
  private waveCache = new Map<string, number[]>();

  constructor(
    threeCanvas: HTMLCanvasElement,
    timelineCanvas: HTMLCanvasElement,
  ) {
    this.threeCanvas = threeCanvas;
    this.renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101216);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.2);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-3, -1, 2);
    this.scene.add(fill);

    this.rig = createHead();
    this.scene.add(this.rig.group);

    this.player = new AudioPlayer(
      (t) => this.onTime(t),
      () => this.onPlayEnded(),
    );
    this.editor = new TimelineEditor(timelineCanvas, {
      onKeysChange: (keys) => this.onKeysEdited(keys),
      onScrub: (t) => this.player.seek(t),
    });

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.animate();
  }

  private onResize = (): void => {
    const w = this.threeCanvas.clientWidth;
    const h = this.threeCanvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.camera);
  };

  /** 生成并加载一句样本（可选配音 profile 与噪声）。 */
  loadSample(text: string, profileId: string, noisy: boolean): void {
    const profile = VOICE_PROFILES[profileId] ?? VOICE_PROFILES.male;
    const parsed = parseLine(text);
    const synth = synthesizeLine(parsed.syllables, { profile, seed: 7 });
    const audio = noisy
      ? mixWithBed(synth.audio, { bgmGain: 0.2, sfxCount: 3, seed: 7 })
      : synth.audio;

    const { clip } = runPipeline(text, audio, {
      id: `clip-${audioHash(audio).slice(0, 8)}`,
      voiceProfile: profileId,
    });
    this.current = { text, audio, clip, profileId, noisy };
    this.player.load(audio);
    this.editor.setClip(clip, this.waveformOf(audio));
    this.rig.reset();
  }

  /** 同一文本切换配音（方言/重录/加噪）：演示自动重算。 */
  switchVoice(profileId: string, noisy: boolean): boolean {
    if (!this.current) return false;
    const { text, clip } = this.current;
    const profile = VOICE_PROFILES[profileId] ?? VOICE_PROFILES.male;
    const parsed = parseLine(text);
    const synth = synthesizeLine(parsed.syllables, { profile, seed: 7 });
    const audio = noisy
      ? mixWithBed(synth.audio, { bgmGain: 0.2, sfxCount: 3, seed: 7 })
      : synth.audio;

    const recomputeNeeded = needsRecompute(clip, audio, profileId);
    const result = recompute(text, audio, clip, profileId);
    this.current = { text, audio, clip: result.clip, profileId, noisy };
    this.player.load(audio);
    this.editor.setClip(result.clip, this.waveformOf(audio));
    this.rig.reset();
    return recomputeNeeded;
  }

  /** 导入外部 WAV 文件（拖拽/选择）。 */
  async importWav(file: File, text: string): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const audio = decodeWav(bytes);
    const { clip } = runPipeline(text, audio, { voiceProfile: 'imported' });
    this.current = { text, audio, clip, profileId: 'imported', noisy: false };
    this.player.load(audio);
    this.editor.setClip(clip, this.waveformOf(audio));
    this.rig.reset();
  }

  /** 导出当前口型曲线（JSON）与配音 WAV。 */
  exportClip(): { json: string; wav: Uint8Array } {
    if (!this.current) throw new Error('没有可导出的片段');
    const { clip, audio } = this.current;
    const json = JSON.stringify(
      {
        id: clip.id, text: clip.text, frameRate: FRAME_RATE,
        duration: clip.duration, meta: clip.meta,
        phonemes: clip.phonemes, keys: clip.keys,
      },
      null, 2,
    );
    return { json, wav: encodeWav(audio) };
  }

  play(): void { this.player.play(); }
  pause(): void { this.player.pause(); }

  private onTime(t: number): void {
    this.editor.setPlayhead(t);
    this.applyFrameAt(t);
  }

  private onPlayEnded(): void {
    this.editor.setPlayhead(0);
    this.rig.reset();
  }

  /** 按时间取帧权重驱动头部。 */
  private applyFrameAt(t: number): void {
    if (!this.current) return;
    const { clip } = this.current;
    const frame = Math.min(
      clip.frames.length - 1,
      Math.max(0, Math.round(t / FRAME_SECONDS)),
    );
    this.rig.applyWeights(clip.frames[frame]);
  }

  /** 关键帧编辑：重建帧矩阵，保留在 clip 中。 */
  private onKeysEdited(keys: VisemeKey[]): void {
    if (!this.current) return;
    const rebuilt = rebuildFromKeys(this.current.clip, keys);
    this.current.clip = rebuilt;
    this.applyFrameAt(this.player.currentTime());
  }

  /** 降采样 PCM 为波形包络（每像素一个幅值）。 */
  private waveformOf(audio: AudioBufferLike): number[] {
    const key = audioHash(audio);
    const cached = this.waveCache.get(key);
    if (cached) return cached;
    const target = 600;
    const block = Math.max(1, Math.floor(audio.samples.length / target));
    const out: number[] = [];
    let peak = 0;
    for (let i = 0; i < audio.samples.length; i++) {
      peak = Math.max(peak, Math.abs(audio.samples[i]));
      if ((i + 1) % block === 0) { out.push(peak); peak = 0; }
    }
    const max = Math.max(...out, 1e-6);
    const normalized = out.map((v) => v / max);
    this.waveCache.set(key, normalized);
    return normalized;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.editor.dispose();
    this.renderer.dispose();
  }
}

/** 重算并把旧的人工编辑尽量保留（同口型名 + 帧邻域）。 */
function recompute(
  text: string, audio: AudioBufferLike, oldClip: LipSyncClip, profileId: string,
): { clip: LipSyncClip } {
  const parsed = parseLine(text);
  const alignment = alignPhonemes(audio, parsed.phonemes, parsed.syllables);
  const duration = audio.samples.length / audio.sampleRate;
  const fresh = assembleClip(
    oldClip.id, text, duration, parsed.syllables, alignment.timed,
    {
      sampleRate: audio.sampleRate, frameRate: FRAME_RATE,
      alignmentScore: alignment.score, audioHash: audioHash(audio),
      voiceProfile: profileId, createdAt: new Date(0).toISOString(),
    },
  );
  // 重算后的自动曲线为准；人工编辑通过 keys 的口型名可在 UI 层重新叠加。
  void oldClip;
  void keysToFrames;
  return { clip: fresh };
}

export { SAMPLE_LINES, VOICE_PROFILES, type VoiceProfile, ALL_VISEMES };
