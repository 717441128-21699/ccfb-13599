/**
 * 核心领域模型 —— 纯类型，不依赖任何运行时环境（浏览器 / Node 通用）。
 */

/** 采样率统一为 16kHz，单声道 16bit PCM，保证浏览器与 Node 管线结果一致。 */
export const SAMPLE_RATE = 16000;
/** 动画帧率 30fps，一帧 = 33.33ms，需求中的「一帧误差」基准。 */
export const FRAME_RATE = 30;
export const FRAME_SECONDS = 1 / FRAME_RATE;
/** 音频分析帧移 10ms，窗长 25ms。 */
export const HOP_SECONDS = 0.01;
export const WINDOW_SECONDS = 0.025;

/**
 * 14 个中文口型（viseme）。
 * 以汉语普通话发音生理动作划分，覆盖全部声母韵母 + 静音。
 */
export type VisemeName =
  | 'sil' // 静音 / 闭合
  | 'AA' // 张大嘴 a, ia, ua
  | 'EH' // 展唇半开 e, ie, üe
  | 'OH' // 圆唇 o, uo
  | 'OO' // 拢圆突出 u
  | 'IU' // 撮口 ü
  | 'ER' // 儿化卷舌
  | 'ZH' // 翘舌 zh/ch/sh/r
  | 'ZS' // 平舌 z/c/s
  | 'JB' // 双唇阻 b/p/m
  | 'LD' // 唇齿 f
  | 'DT' // 舌尖阻 d/t/n/l
  | 'GG' // 舌根阻 g/k/h
  | 'QX'; // 舌面阻 j/q/x

export const ALL_VISEMES: readonly VisemeName[] = [
  'sil', 'AA', 'EH', 'OH', 'OO', 'IU', 'ER',
  'ZH', 'ZS', 'JB', 'LD', 'DT', 'GG', 'QX',
];

/** 声母（零声母用空串表示）。 */
export type Initial =
  | '' | 'b' | 'p' | 'm' | 'f' | 'd' | 't' | 'n' | 'l'
  | 'g' | 'k' | 'h' | 'j' | 'q' | 'x'
  | 'zh' | 'ch' | 'sh' | 'r' | 'z' | 'c' | 's';

/** 韵母（带介音的完整韵母形式，见拼音表）。 */
export type Final =
  | 'a' | 'o' | 'e' | 'i' | 'u' | 'ü' | 'er'
  | 'ai' | 'ei' | 'ao' | 'ou' | 'an' | 'en' | 'ang' | 'eng'
  | 'ia' | 'ie' | 'iao' | 'iu' | 'ian' | 'in' | 'iang' | 'ing'
  | 'ua' | 'uo' | 'uai' | 'ui' | 'uan' | 'un' | 'uang' | 'ueng' | 'ong'
  | 'üe' | 'üan' | 'ün' | 'iong';

/** 声调：1-4 四声，0 轻声，5 句中变调（实际调值由变调规则解析后仍是 1-4/0）。 */
export type Tone = 0 | 1 | 2 | 3 | 4;

/** 一个汉字的拼音解析结果。 */
export interface PinyinSyllable {
  /** 原始汉字（标点时为空）。 */
  char: string;
  initial: Initial;
  final: Final | null;
  tone: Tone;
  /** 儿化标记：该音节后接「儿」并并入（如 花儿 huār）。 */
  erhua: boolean;
  /** 轻声（包括词典标注轻声与结构助词等）。 */
  neutral: boolean;
  /** 是否为标点 / 停顿占位。 */
  isPause: boolean;
  /** 停顿秒数（仅 isPause 时有值）。 */
  pauseSeconds?: number;
}

/** 音素级单元：声母、韵母核、韵尾、儿化等，对齐的最小单位。 */
export type PhonemeKind =
  | 'silence'
  | 'initial' // 声母（辅音）
  | 'vowel' // 韵母主元音
  | 'nasal-coda' // -n / -ng 韵尾
  | 'er-cap'; // 儿化附加动作

export interface Phoneme {
  /** 在整句音素序列中的序号。 */
  index: number;
  kind: PhonemeKind;
  /** 音素标签，声母如 "b"，元音用韵母标签如 "a"/"ie"，韵尾 "n"/"ng"。 */
  label: string;
  /** 所属音节（汉字）在句子中的序号，便于编辑器按字回跳。 */
  syllableIndex: number;
  /** 该音素映射到的口型。 */
  viseme: VisemeName;
  /** 文本侧预测的典型时长（秒），作为 Viterbi 的先验。 */
  expectedDuration: number;
}

/** 对齐后的时间边界（秒）。 */
export interface TimedPhoneme extends Phoneme {
  start: number;
  end: number;
}

/** 一个口型关键帧（按帧索引存储，权重 0..1）。 */
export interface VisemeKey {
  /** 帧序号（30fps）。 */
  frame: number;
  viseme: VisemeName;
  weight: number;
}

/** 单条口型片段：音频 + 对齐结果 + 可编辑曲线。 */
export interface LipSyncClip {
  id: string;
  text: string;
  /** 音频总时长（秒）。 */
  duration: number;
  syllables: PinyinSyllable[];
  phonemes: TimedPhoneme[];
  /** 每帧 14 个口型权重矩阵，frames[frameIndex][visemeOrdinal]。 */
  frames: number[][];
  /** 编辑器关键帧（稀疏）；为空时由 frames 反推。 */
  keys: VisemeKey[];
  /** 元信息。 */
  meta: ClipMeta;
}

export interface ClipMeta {
  sampleRate: number;
  frameRate: number;
  /** 对齐质量指标。 */
  alignmentScore: number;
  /** 生成参数指纹：音频内容/参数变化则触发重算。 */
  audioHash: string;
  /** 使用的方言/风格标识（重录或换配音时区分）。 */
  voiceProfile: string;
  createdAt: string;
}

/** 批量清单中的一条任务。 */
export interface BatchJob {
  id: string;
  text: string;
  /** 相对数据目录的音频路径。 */
  audio: string;
  /** 可选：人工指定拼音（每行一个汉字/词的拼音，空格分隔），覆盖词典。 */
  pinyinOverride?: string;
  voiceProfile?: string;
}

export interface BatchResult {
  job: BatchJob;
  ok: boolean;
  error?: string;
  clip?: LipSyncClip;
  /** 处理耗时（毫秒）。 */
  elapsedMs: number;
}

/** 对齐精度评估结果（测试用）。 */
export interface AccuracyReport {
  clips: number;
  /** 每个音素边界与真值的绝对误差（毫秒）。 */
  boundaryErrorsMs: number[];
  meanErrorMs: number;
  p95ErrorMs: number;
  maxErrorMs: number;
  /** 误差 ≤ 33.3ms 的边界占比。 */
  withinOneFrameRatio: number;
}

/** 一维浮点 PCM 音频缓冲（单声道）。 */
export interface AudioBufferLike {
  samples: Float32Array;
  sampleRate: number;
}
