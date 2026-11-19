/**
 * 文本 → 拼音音节 → 音素/口型序列。
 *
 * 处理：
 *  1. 最长匹配语境词表，解析多音字、轻声词；
 *  2. 「一」「不」变调、三声连读变调、叠词轻声；
 *  3. 儿化合并（花儿 huār，非儿化词如 儿童 不合并）；
 *  4. 标点转停顿；
 *  5. 声母/韵母拆成音素，映射 14 个口型，并给出时长先验。
 */
import {
  ERHUA_EXCEPTIONS, lookupChar, lookupWord,
  registerReadings, registerWords, type EncodedReading,
} from './dictionary';
import type {
  Final, Initial, Phoneme, PinyinSyllable, Tone, VisemeName,
} from './types';

export const INITIALS: readonly Initial[] = [
  'zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
  'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', '',
];

export const FINALS: readonly Final[] = [
  'a', 'o', 'e', 'i', 'u', 'ü', 'er',
  'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng',
  'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing',
  'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ueng', 'ong',
  'üe', 'üan', 'ün', 'iong',
];

/** 声母 → 口型。 */
export const INITIAL_VISEME: Record<Exclude<Initial, ''>, VisemeName> = {
  b: 'JB', p: 'JB', m: 'JB',
  f: 'LD',
  d: 'DT', t: 'DT', n: 'DT', l: 'DT',
  g: 'GG', k: 'GG', h: 'GG',
  j: 'QX', q: 'QX', x: 'QX',
  zh: 'ZH', ch: 'ZH', sh: 'ZH', r: 'ZH',
  z: 'ZS', c: 'ZS', s: 'ZS',
};

/** 韵母 → 主元音口型。 */
export const FINAL_VISEME: Record<Final, VisemeName> = {
  a: 'AA', ia: 'AA', ua: 'AA',
  o: 'OH', uo: 'OH', ou: 'OH', iu: 'OH',
  e: 'EH', ie: 'EH', ei: 'EH', ui: 'EH',
  ai: 'AA', ao: 'AA',
  u: 'OO',
  ü: 'IU', üe: 'IU', üan: 'IU', ün: 'IU',
  er: 'ER',
  an: 'AA', en: 'EH', in: 'EH', ian: 'EH', uan: 'AA',
  un: 'OH', ang: 'AA', iang: 'AA', uang: 'AA',
  eng: 'EH', ing: 'EH', ueng: 'OH', ong: 'OH', iong: 'IU',
  uai: 'AA', i: 'EH', iao: 'AA',
};

/** 零声母韵母（y/w 开头音节）的口型同上，直接走 FINAL_VISEME。 */

/** 解析 "n:i3" 这类编码。 */
export function decodeReading(code: EncodedReading): {
  initial: Initial; final: Final; tone: Tone;
} {
  const colon = code.indexOf(':');
  const initial = (colon === 0 ? '' : code.slice(0, colon)) as Initial;
  const rest = code.slice(colon + 1);
  const tone = Number(rest[rest.length - 1]) as Tone;
  const final = rest.slice(0, -1) as Final;
  if (!FINALS.includes(final)) {
    throw new Error(`词典读音编码错误：${code}（韵母 ${final} 不在拼音表）`);
  }
  return { initial, final, tone };
}

const PAUSE_CHARS = new Map<string, number>([
  ['，', 0.22], [',', 0.22], ['。', 0.38], ['.', 0.38],
  ['！', 0.35], ['!', 0.35], ['？', 0.35], ['?', 0.35],
  ['；', 0.3], [';', 0.3], ['：', 0.26], [':', 0.26],
  ['、', 0.18], ['…', 0.4], ['—', 0.25], ['～', 0.2],
]);

/** 词表最大长度，用于最长匹配。 */
const MAX_WORD_LEN = 4;

interface TextToken {
  char: string;
  reading?: EncodedReading;
  pause?: number;
}

/** 第一步：分词 + 词典/词表匹配，产出带读音的 token。 */
function tokenize(text: string, override?: string): TextToken[] {
  const tokens: TextToken[] = [];
  // 人工拼音覆盖：按空格/竖线切，逐个对应汉字。
  const overrideQueue = override
    ? override.split(/[\s|]+/).filter(Boolean).map(parseLoosePinyin)
    : undefined;
  let overrideIdx = 0;

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    const pause = PAUSE_CHARS.get(ch);
    if (pause !== undefined) {
      tokens.push({ char: ch, pause });
      i++;
      continue;
    }
    // 非汉字（数字、英文等）按未知字处理：跳过但不中断。
    if (!/[一-鿿]/.test(ch)) {
      tokens.push({ char: ch });
      i++;
      continue;
    }

    if (overrideQueue) {
      const reading = overrideQueue[overrideIdx++];
      if (reading) {
        tokens.push({ char: ch, reading });
        i++;
        continue;
      }
    }

    // 最长匹配语境词。
    let matched: { word: string; readings: EncodedReading[] } | null = null;
    for (let len = Math.min(MAX_WORD_LEN, text.length - i); len >= 2; len--) {
      const word = text.slice(i, i + len);
      const readings = lookupWord(word);
      if (readings && readings.length === len) {
        matched = { word, readings };
        break;
      }
    }
    if (matched) {
      for (let k = 0; k < matched.word.length; k++) {
        tokens.push({ char: matched.word[k], reading: matched.readings[k] });
      }
      i += matched.word.length;
      continue;
    }

    const readings = lookupChar(ch);
    tokens.push({ char: ch, reading: readings?.[0] });
    i++;
  }
  return tokens;
}

/** 解析宽松拼音输入（如 "hua1" / "hua r" / "ni3"），转内部编码。 */
function parseLoosePinyin(raw: string): EncodedReading {
  const s = raw.trim().toLowerCase().replace('v', 'ü');
  const m = s.match(/^([bpmfdtnlgkhjqxrzcs]|ch|sh|zh)?(.*?)([0-5])?$/);
  if (!m) throw new Error(`无法解析拼音：${raw}`);
  const initial = (m[1] ?? '') as Initial;
  let final = m[2] as Final;
  const tone = (m[4] && m[4] !== '5' ? Number(m[4]) : 0) as Tone;
  // j/q/x/y 后 u 实际是 ü；零声母 y- 还原。
  if (initial && ('jqx'.includes(initial)) && final.startsWith('u')) {
    final = ('ü' + final.slice(1)) as Final;
  }
  if (!initial) {
    if (final.startsWith('y')) {
      final = normalizeY(final);
    } else if (final.startsWith('w')) {
      final = normalizeW(final);
    }
  }
  if (!FINALS.includes(final)) {
    throw new Error(`拼音韵母不在拼音表：${raw} → ${final}`);
  }
  return `${initial}:${final}${tone}`;
}

function normalizeY(f: string): Final {
  if (f === 'yi') return 'i';
  if (f === 'ya') return 'ia';
  if (f === 'yao') return 'iao';
  if (f === 'ye') return 'ie';
  if (f === 'you') return 'iu';
  if (f === 'yan') return 'ian';
  if (f === 'yin') return 'in';
  if (f === 'yang') return 'iang';
  if (f === 'ying') return 'ing';
  if (f === 'yong') return 'iong';
  if (f === 'yu' || f === 'yue' || f === 'yuan' || f === 'yun') {
    return ({ yu: 'ü', yue: 'üe', yuan: 'üan', yun: 'ün' })[f] as Final;
  }
  return f as Final;
}

function normalizeW(f: string): Final {
  if (f === 'wu') return 'u';
  if (f === 'wa') return 'ua';
  if (f === 'wo') return 'uo';
  if (f === 'wai') return 'uai';
  if (f === 'wei') return 'ui';
  if (f === 'wan') return 'uan';
  if (f === 'wen') return 'un';
  if (f === 'wang') return 'uang';
  if (f === 'weng') return 'ueng';
  return f as Final;
}

/** 第二步：变调与轻声规则，输出 PinyinSyllable（含停顿项）。 */
function applySandhi(tokens: TextToken[]): PinyinSyllable[] {
  // 先解出基础音节，停顿单独保留。
  interface Decoded {
    syllable?: PinyinSyllable;
    pause?: PinyinSyllable;
    reading: EncodedReading | undefined;
  }
  const decoded: Decoded[] = tokens.map((t) => {
    if (t.pause !== undefined) {
      return {
        reading: undefined,
        pause: {
          char: t.char, initial: '', final: null, tone: 0,
          erhua: false, neutral: false, isPause: true, pauseSeconds: t.pause,
        },
      };
    }
    if (!t.reading) {
      // 未登录字：给一个占位的中性读音，标记后由调用方统计。
      return {
        reading: undefined,
        syllable: {
          char: t.char, initial: '', final: 'e', tone: 0,
          erhua: false, neutral: true, isPause: false,
        },
      };
    }
    const r = decodeReading(t.reading);
    return {
      reading: t.reading,
      syllable: {
        char: t.char, initial: r.initial, final: r.final, tone: r.tone,
        erhua: false, neutral: r.tone === 0, isPause: false,
      },
    };
  });

  const syls = decoded.filter((d) => d.syllable).map((d) => d.syllable!);

  // —— 「一」变调 ——
  for (let i = 0; i < syls.length; i++) {
    const s = syls[i];
    if (s.char !== '一' || s.isPause) continue;
    const next = nextSpoken(syls, i);
    if (!next) { s.tone = 1; continue; }
    if (next.tone === 4) s.tone = 2;
    else if (next.tone === 1 || next.tone === 2 || next.tone === 3) s.tone = 4;
    // 序数「第一名/一月」用默认 1 声的判断代价过高，这里按规则走，
    // 偏差只影响基频曲线，不影响口型。
  }

  // —— 「不」变调 ——
  for (let i = 0; i < syls.length; i++) {
    const s = syls[i];
    if (s.char !== '不') continue;
    const next = nextSpoken(syls, i);
    if (next && next.tone === 4) s.tone = 2;
  }

  // —— 三声连读 ——
  for (let i = 0; i < syls.length; i++) {
    const s = syls[i];
    if (s.tone !== 3) continue;
    const next = nextSpoken(syls, i);
    if (next && next.tone === 3) s.tone = 2;
  }

  // —— 叠词轻声（妈妈、星星、看看）——
  for (let i = 0; i < syls.length - 1; i++) {
    if (syls[i].char === syls[i + 1].char && !syls[i].neutral) {
      // 单字叠用且非三声变调场景时，第二个轻声；亲属称谓强制轻声。
      syls[i + 1].neutral = true;
      syls[i + 1].tone = 0;
    }
  }

  // —— 儿化合并 ——
  // 规则：后附的「儿」只要不属于独立词（儿童/儿子/婴儿…，见
  // ERHUA_EXCEPTIONS），一律并入前字作儿化（覆盖轻声儿与带 2 声的
  // 「小孩儿、慢慢儿」等）；例外词里的「儿」保持独立音节。
  for (let i = 0; i < syls.length; i++) {
    const s = syls[i];
    if (s.char !== '儿') continue;
    const prev = prevSpoken(syls, i);
    if (!prev) continue;
    if (ERHUA_EXCEPTIONS.has(prev.char + '儿')) continue;
    prev.erhua = true;
    s.isPause = true; // 标记为吞掉，输出时跳过
    s.pauseSeconds = 0;
  }

  // —— 按原顺序重建（含停顿）——
  const out: PinyinSyllable[] = [];
  let si = 0;
  for (const d of decoded) {
    if (d.pause) { out.push(d.pause); continue; }
    const s = syls[si++];
    if (s.isPause && s.pauseSeconds === 0) continue; // 被儿化吞掉的「儿」
    out.push(s);
  }
  return out;
}

function nextSpoken(syls: PinyinSyllable[], i: number): PinyinSyllable | undefined {
  for (let j = i + 1; j < syls.length; j++) {
    if (!syls[j].isPause) return syls[j];
  }
  return undefined;
}

function prevSpoken(syls: PinyinSyllable[], i: number): PinyinSyllable | undefined {
  for (let j = i - 1; j >= 0; j--) {
    if (!syls[j].isPause) return syls[j];
  }
  return undefined;
}

/** 未登录字收集（诊断用）。 */
export function findUnknownChars(text: string): string[] {
  const unknown = new Set<string>();
  for (const ch of text) {
    if (/[一-鿿]/.test(ch) && !lookupChar(ch)) unknown.add(ch);
  }
  return [...unknown];
}

/** 单条音节的音素拆分（不含时间，时间先验在 phoneme-prior 里）。 */
export function syllableToPhonemes(
  syl: PinyinSyllable, syllableIndex: number, startIndex: number,
): Phoneme[] {
  const out: Phoneme[] = [];
  let idx = startIndex;
  const push = (
    kind: Phoneme['kind'], label: string, viseme: VisemeName,
    expectedDuration: number,
  ) => {
    out.push({
      index: idx++, kind, label, syllableIndex, viseme, expectedDuration,
    });
  };

  if (syl.initial) {
    push('initial', syl.initial, INITIAL_VISEME[syl.initial],
      initialDuration(syl.initial));
  }
  if (syl.final) {
    push('vowel', syl.final, FINAL_VISEME[syl.final],
      vowelDuration(syl.final, syl.neutral));
    const coda = nasalCoda(syl.final);
    if (coda) {
      push('nasal-coda', coda, coda === 'ng' ? 'GG' : 'DT',
        syl.neutral ? 0.05 : 0.08);
    }
    if (syl.erhua) {
      push('er-cap', 'er', 'ER', 0.08);
    }
  }
  return out;
}

function nasalCoda(f: Final): 'n' | 'ng' | null {
  if (f.endsWith('ng')) return 'ng';
  if (f.endsWith('n') && f !== 'er') return 'n';
  return null;
}

/**
 * 时长先验（秒）。与 synth.ts 的 phonemeDuration 保持同一基准数值，
 * 使「文本先验」与「发音模型」同源，避免系统性时长偏差累积。
 * 真实配音的个体差异由 Viterbi 的 σ 容忍度吸收。
 */
function initialDuration(i: Exclude<Initial, ''>): number {
  if ('bpdtgk'.includes(i)) return 0.075;       // 塞音
  if ('f h s sh x r'.includes(i)) return 0.12; // 擦音
  if ('c ch q'.includes(i)) return 0.13;       // 送气塞擦音
  if ('z zh j'.includes(i)) return 0.11;       // 不送气塞擦音
  return 0.095;                                // m/n/l 鼻/边音
}

function vowelDuration(f: Final, neutral: boolean): number {
  // 合成器元音统一 0.18（轻声 0.12）；韵母长短差异留给声学证据微调。
  void f;
  return neutral ? 0.12 : 0.18;
}

/** 整句入口：文本 → 音节 + 音素（含口型与时长先验）。 */
export interface ParsedLine {
  syllables: PinyinSyllable[];
  phonemes: Phoneme[];
  unknownChars: string[];
}

export function parseLine(text: string, pinyinOverride?: string): ParsedLine {
  const tokens = tokenize(text, pinyinOverride);
  const syllables = applySandhi(tokens);
  const phonemes: Phoneme[] = [];
  syllables.forEach((syl, si) => {
    if (syl.isPause) return;
    phonemes.push(...syllableToPhonemes(syl, si, phonemes.length));
  });
  return {
    syllables,
    phonemes,
    unknownChars: findUnknownChars(text),
  };
}

export { registerReadings, registerWords };
