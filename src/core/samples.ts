/**
 * 内置样本台词库：24 句覆盖儿化、轻声、三声连读、「一/不」变调、
 * 鼻韵尾、零声母、标点停顿、多音字等全部目标语音现象。
 * 另有随机句词库供批量基准（500 句/小时吞吐验证）使用。
 */

export interface SampleLine {
  id: string;
  text: string;
  /** 该句重点考察的现象。 */
  focus: string[];
}

export const SAMPLE_LINES: SampleLine[] = [
  { id: 's01', text: '你好，欢迎来到我们的游戏世界。', focus: ['轻声', '零声母'] },
  { id: 's02', text: '今天天气真好，我们一起出去玩儿吧！', focus: ['儿化', '轻声', '变调'] },
  { id: 's03', text: '他吃了一碗面条，又喝了点儿水。', focus: ['儿化', '轻声', '零声母'] },
  { id: 's04', text: '这个小孩儿真可爱。', focus: ['儿化', '轻声'] },
  { id: 's05', text: '请稍等一下，我马上就来。', focus: ['三声连读', '变调'] },
  { id: 's06', text: '站住！不许跑！', focus: ['四声', '不变调'] },
  { id: 's07', text: '师傅，请问火车站怎么走？', focus: ['轻声', '翘舌'] },
  { id: 's08', text: '春天到了，花儿都开了，小鸟在树上唱歌。', focus: ['儿化', '轻声'] },
  { id: 's09', text: '妈妈说，做人要老老实实。', focus: ['叠词轻声', '三声连读'] },
  { id: 's10', text: '同学们都喜欢打篮球。', focus: ['多音字'] },
  { id: 's11', text: '三百六十五个夜晚，星星眨着眼睛。', focus: ['轻声', '零声母'] },
  { id: 's12', text: '把书放在桌子上，然后去房间休息。', focus: ['轻声'] },
  { id: 's13', text: '别着急，慢慢儿说。', focus: ['儿化', '轻声'] },
  { id: 's14', text: '下雨天别忘了带伞。', focus: ['轻声', '鼻韵尾'] },
  { id: 's15', text: '这件事情你有什么看法？', focus: ['轻声', '翘舌', '平舌'] },
  { id: 's16', text: '长城是中国古代最伟大的建筑之一。', focus: ['多音字', '零声母'] },
  { id: 's17', text: '红灯停，绿灯行，交通安全要记牢。', focus: ['多音字'] },
  { id: 's18', text: '谢谢你的帮助，这是一份小礼物。', focus: ['轻声'] },
  { id: 's19', text: '老板，来两碗豆浆，四个包子。', focus: ['轻声', '量词'] },
  { id: 's20', text: '同学们高高兴兴地向操场跑去。', focus: ['叠词', '多音字'] },
  { id: 's21', text: '语音合成技术让角色能够口型同步。', focus: ['专业词', '零声母'] },
  { id: 's22', text: '只要努力练习，就能说得很准确。', focus: ['三声连读', '变调'] },
  { id: 's23', text: '从前有座山，山里有座庙。', focus: ['零声母', '鼻韵尾'] },
  { id: 's24', text: '我梦见了一个圆圆的月亮。', focus: ['零声母', '撮口'] },
];

/** 批量基准用的短句词库（全部用字都在内置词典内）。 */
export const BENCH_WORDS: string[] = [
  '你好', '我们', '他们', '同学', '老师', '朋友', '妈妈', '爸爸',
  '今天', '明天', '早上', '晚上', '春天', '天气', '下雨', '刮风',
  '火车', '车站', '城市', '长城', '商店', '房间', '桌子', '椅子',
  '面条', '米饭', '包子', '豆浆', '水果', '苹果', '茶水', '礼物',
  '小鸟', '小狗', '花猫', '山羊', '草地', '花儿', '大树', '河水',
  '打球', '跑步', '唱歌', '跳舞', '读书', '写字', '画画', '休息',
  '高兴', '快乐', '可爱', '漂亮', '慢慢', '轻轻', '赶紧', '马上',
  '一起', '一下', '不要', '不是', '可以', '怎么', '什么', '这个',
];

const BENCH_TEMPLATES: ((w: string) => string)[] = [
  (w) => `我们一起去${w}吧。`,
  (w) => `他说${w}真的很好玩儿。`,
  (w) => `${w}的时候要小心一点儿。`,
  (w) => `你看，${w}就在那儿。`,
  (w) => `请把${w}放在桌子上。`,
  (w) => `${w}，我们马上就走。`,
  (w) => `我最喜欢${w}了。`,
  (w) => `他们在${w}吗？`,
];

/** 确定性伪随机（线性同余），保证基准集可复现。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 生成 N 条基准台词（去重）。 */
export function generateBenchLines(n: number, seed = 20261120): SampleLine[] {
  const rnd = lcg(seed);
  const seen = new Set<string>();
  const out: SampleLine[] = [];
  let guard = 0;
  while (out.length < n && guard < n * 20) {
    guard++;
    const w = BENCH_WORDS[Math.floor(rnd() * BENCH_WORDS.length)];
    const tpl = BENCH_TEMPLATES[Math.floor(rnd() * BENCH_TEMPLATES.length)];
    const text = tpl(w);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ id: `b${String(out.length + 1).padStart(4, '0')}`, text, focus: ['benchmark'] });
  }
  return out;
}
