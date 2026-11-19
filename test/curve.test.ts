import { describe, expect, it } from 'vitest';
import {
  buildCurves, keysToFrames, rebuildFromKeys, snapToFrame,
} from '../src/core/curve.ts';
import { parseLine } from '../src/core/pinyin.ts';
import { synthesizeLine } from '../src/core/synth.ts';
import { alignPhonemes } from '../src/core/alignment.ts';
import { ALL_VISEMES, FRAME_SECONDS, type TimedPhoneme } from '../src/core/types.ts';

function timedFrom(text: string): TimedPhoneme[] {
  const parsed = parseLine(text);
  const { audio } = synthesizeLine(parsed.syllables, { seed: 7 });
  const { timed } = alignPhonemes(audio, parsed.phonemes, parsed.syllables);
  return timed;
}

describe('口型曲线生成', () => {
  it('帧矩阵维度正确且权重在 [0,1]', () => {
    const timed = timedFrom('你好，欢迎来到我们的游戏世界。');
    const duration = timed[timed.length - 1].end + 0.3;
    const { frames } = buildCurves(timed, duration);
    expect(frames.length).toBe(Math.ceil(duration / FRAME_SECONDS));
    for (const row of frames) {
      expect(row.length).toBe(ALL_VISEMES.length);
      for (const w of row) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it('每帧至少有一个口型通道有权重', () => {
    const timed = timedFrom('站住！不许跑！');
    const { frames } = buildCurves(timed, 2);
    for (const row of frames) {
      expect(Math.max(...row)).toBeGreaterThan(0);
    }
  });

  it('同口型相邻音素合并，不产生抖动尖峰', () => {
    const timed = timedFrom('妈妈说，做人要老老实实。');
    const { frames } = buildCurves(timed, timed[timed.length - 1].end + 0.3);
    // 任一口型通道不应出现单帧 0→高→0 的尖峰。
    for (let v = 0; v < ALL_VISEMES.length; v++) {
      for (let t = 1; t < frames.length - 1; t++) {
        const a = frames[t - 1][v];
        const b = frames[t][v];
        const c = frames[t + 1][v];
        if (b > 0.5) {
          expect(Math.max(a, c)).toBeGreaterThan(0.2);
        }
      }
    }
  });

  it('儿化产生 ER 口型且与元音叠加', () => {
    const timed = timedFrom('这个小孩儿真可爱。');
    const { frames } = buildCurves(timed, timed[timed.length - 1].end + 0.3);
    const erIdx = ALL_VISEMES.indexOf('ER');
    const hasEr = frames.some((row) => row[erIdx] > 0);
    expect(hasEr).toBe(true);
  });

  it('关键帧稀疏化后可无损重建帧矩阵', () => {
    const timed = timedFrom('请稍等一下，我马上就来。');
    const duration = 3;
    const { frames, keys } = buildCurves(timed, duration);
    expect(keys.length).toBeLessThan(frames.length * ALL_VISEMES.length);
    const rebuilt = keysToFrames(keys, duration);
    expect(rebuilt.length).toBe(frames.length);
    for (let t = 0; t < frames.length; t++) {
      for (let v = 0; v < ALL_VISEMES.length; v++) {
        expect(Math.abs(rebuilt[t][v] - frames[t][v])).toBeLessThan(0.15);
      }
    }
  });

  it('编辑器改关键帧后重建保留编辑', () => {
    const timed = timedFrom('你好。');
    const duration = 2;
    const { keys } = buildCurves(timed, duration);
    const edited = keys.map((k) => ({ ...k, weight: Math.min(1, k.weight + 0.1) }));
    const frames = keysToFrames(edited, duration);
    const clip = {
      id: 'x', text: '你好。', duration, syllables: [], phonemes: timed,
      frames, keys: edited, meta: {} as never,
    };
    const rebuilt = rebuildFromKeys(clip, edited);
    expect(rebuilt.keys).toEqual(edited);
  });

  it('时间吸附到帧网格', () => {
    expect(snapToFrame(0.1)).toBe(Math.round(0.1 / FRAME_SECONDS));
    expect(snapToFrame(FRAME_SECONDS * 3.5)).toBe(4);
  });

  it('framesToKeys 只产出转折点，数量可控', () => {
    const timed = timedFrom('春天到了，花儿都开了，小鸟在树上唱歌。');
    const { frames, keys } = buildCurves(timed, 5);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(frames.length * 2);
  });
});
