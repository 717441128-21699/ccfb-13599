import { describe, expect, it } from 'vitest';
import { decodeReading, parseLine } from '../src/core/pinyin.ts';

describe('拼音解析与变调', () => {
  it('解析基础读音编码', () => {
    expect(decodeReading('n:i3')).toEqual({ initial: 'n', final: 'i', tone: 3 });
    expect(decodeReading(':a1')).toEqual({ initial: '', final: 'a', tone: 1 });
    expect(decodeReading('q:ü4')).toEqual({ initial: 'q', final: 'ü', tone: 4 });
  });

  it('零声母 y/w 还原为规范韵母', () => {
    const r = parseLine('我们');
    expect(r.syllables[0].initial).toBe('');
    expect(r.syllables[0].final).toBe('uo');
  });

  it('三声连读：前字变二声', () => {
    const r = parseLine('你好');
    // 你(3) + 好(3) → 你变 2 声
    expect(r.syllables[0].tone).toBe(2);
    expect(r.syllables[1].tone).toBe(3);
  });

  it('「不」在四声前变二声', () => {
    const r = parseLine('不要');
    const bu = r.syllables.find((s) => s.char === '不')!;
    expect(bu.tone).toBe(2);
  });

  it('「一」在非四声前变四声', () => {
    const r = parseLine('一起');
    const yi = r.syllables.find((s) => s.char === '一')!;
    expect(yi.tone).toBe(4);
  });

  it('儿化合并到前字，独立「儿」不合并', () => {
    const r1 = parseLine('小孩儿');
    const hai = r1.syllables.find((s) => s.char === '孩')!;
    expect(hai.erhua).toBe(true);
    // 儿被吞掉，不占独立音节
    expect(r1.syllables.filter((s) => s.char === '儿')).toHaveLength(0);

    const r2 = parseLine('儿童');
    expect(r2.syllables.some((s) => s.char === '儿' && !s.isPause)).toBe(true);
  });

  it('轻声词识别', () => {
    const r = parseLine('我们');
    expect(r.syllables[1].neutral).toBe(true);
    expect(r.syllables[1].tone).toBe(0);
  });

  it('叠词第二字轻声', () => {
    const r = parseLine('妈妈');
    expect(r.syllables[0].neutral).toBe(false);
    expect(r.syllables[1].neutral).toBe(true);
  });

  it('多音字语境词表优先', () => {
    const r = parseLine('长城');
    const chang = r.syllables[0];
    expect(chang.final).toBe('ang');
    expect(chang.initial).toBe('ch');
  });

  it('标点转停顿', () => {
    const r = parseLine('你好，世界。');
    const pauses = r.syllables.filter((s) => s.isPause);
    expect(pauses.length).toBe(2);
    expect(pauses[0].pauseSeconds).toBeGreaterThan(0);
  });

  it('每个音素都映射到合法口型', () => {
    const r = parseLine('语音合成技术让角色能够口型同步');
    expect(r.phonemes.length).toBeGreaterThan(0);
    for (const p of r.phonemes) {
      expect(p.viseme).toBeTruthy();
      expect(p.expectedDuration).toBeGreaterThan(0);
    }
  });

  it('未登录字被收集', () => {
    const r = parseLine('你好xyz');
    // xyz 非汉字不计入；含生僻字时应报告
    expect(Array.isArray(r.unknownChars)).toBe(true);
  });
});
