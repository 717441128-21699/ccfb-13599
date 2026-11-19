/**
 * 内置拼音词典（紧凑编码）。
 *
 * 读音编码：`声母:韵母声调`，零声母的声母留空，例如
 *   "n:i3" = n + i + 第三声；":a1" = 啊（零声母）；"q:ü4" = 去。
 * 一个字有多个读音时按使用频率排列，第一个是默认读音；
 * 语境词表 WORDS 用最长匹配覆盖多音字与轻声词。
 *
 * 设计目标：覆盖内置样本语料与批量基准词库；未登录字可通过
 * registerReadings() 扩展，或在任务里用 pinyinOverride 人工指定。
 */

export type EncodedReading = string; // 形如 "n:i3" / ":er2"

export const CHAR_READINGS: Record<string, EncodedReading[]> = {
  // —— 样本语料用字 ——
  你: ['n:i3'], 好: ['h:ao3'], 欢: ['h:uan1'], 迎: [':ing2'],
  来: ['l:ai2'], 到: ['d:ao4'], 我: [':uo3'], 们: ['m:en0'],
  的: ['d:e0', 'd:i2', 'd:i4'], 游: [':iu2'], 戏: ['x:i4'],
  世: ['sh:i4'], 界: ['j:ie4'], 今: ['j:in1'], 天: ['t:ian1'],
  气: ['q:i4'], 真: ['zh:en1'], 一: [':i1'], 起: ['q:i3'],
  出: ['ch:u1'], 去: ['q:ü4'], 玩: [':uan2'], 儿: [':er2'],
  吧: ['b:a0'], 他: ['t:a1'], 吃: ['ch:i1'], 了: ['l:e0', 'l:iao3'],
  碗: [':uan3'], 面: ['m:ian4'], 条: ['t:iao2'], 又: [':iu4'],
  喝: ['h:e1', 'h:e4'], 点: ['d:ian3'], 水: ['sh:ui3'],
  这: ['zh:e4'], 个: ['g:e4', 'g:e0'], 小: ['x:iao3'], 孩: ['h:ai2'],
  可: ['k:e3', 'k:e4'], 爱: [':ai4'], 蛋: ['d:an4'], 圆: [':üan2'],
  请: ['q:ing3'], 稍: ['sh:ao1'], 等: ['d:eng3'], 下: ['x:ia4'],
  马: ['m:a3'], 上: ['sh:ang3', 'sh:ang4'], 就: ['j:iu4'],
  站: ['zh:an4'], 住: ['zh:u4'], 再: ['z:ai4'], 不: ['b:u4'],
  跑: ['p:ao3'], 及: ['j:i2'], 师: ['sh:i1'], 傅: ['f:u4', 'f:u0'],
  问: [':un4'], 火: ['h:uo3'], 车: ['ch:e1'], 怎: ['z:en3'],
  么: ['m:e0'], 走: ['z:ou3'], 春: ['ch:un1'], 花: ['h:ua1'],
  都: ['d:ou1', 'd:u1'], 开: ['k:ai1'], 鸟: ['n:iao3'],
  在: ['z:ai4'], 树: ['sh:u4'], 唱: ['ch:ang4'], 歌: ['g:e1'],
  妈: ['m:a1'], 说: ['sh:uo1'], 做: ['z:uo4'], 人: ['r:en2'],
  要: [':iao4', ':iao1'], 老: ['l:ao3'], 实: ['sh:i2'],
  班: ['b:an1'], 同: ['t:ong2'], 学: ['x:üe2'], 喜: ['x:i3'],
  打: ['d:a3', 'd:a2'], 篮: ['l:an2'], 球: ['q:iu2'],
  三: ['s:an1'], 百: ['b:ai3'], 六: ['l:iu4'], 十: ['sh:i2'],
  五: [':u3'], 夜: [':ie4'], 晚: [':uan3'], 星: ['x:ing1'],
  眨: ['zh:a3'], 着: ['zh:e0', 'zh:ao2', 'zh:uo2'], 眼: [':ian3'],
  睛: ['j:ing1', 'j:ing0'], 把: ['b:a3', 'b:a4'], 书: ['sh:u1'],
  放: ['f:ang4'], 桌: ['zh:uo1'], 子: ['z:i3', 'z:i0'],
  然: ['r:an2'], 后: ['h:ou4'], 房: ['f:ang2'], 间: ['j:ian1', 'j:ian4'],
  别: ['b:ie2'], 急: ['j:i2'], 慢: ['m:an4'], 听: ['t:ing1'],
  雨: [':ü3'], 忘: [':uang4'], 带: ['d:ai4'], 伞: ['s:an3'],
  件: ['j:ian4'], 事: ['sh:i4'], 情: ['q:ing2'], 看: ['k:an4', 'k:an1'],
  想: ['x:iang3'], 法: ['f:a3'], 长: ['ch:ang2', 'zh:ang3'],
  城: ['ch:eng2'], 是: ['sh:i4'], 中: ['zh:ong1', 'zh:ong4'],
  国: ['g:uo2'], 古: ['g:u3'], 代: ['d:ai4'], 最: ['z:ui4'],
  伟: [':ui3'], 大: ['d:a4'], 建: ['j:ian4'], 筑: ['zh:u4'],
  之: ['zh:i1'], 红: ['h:ong2'], 灯: ['d:eng1'], 停: ['t:ing2'],
  绿: ['l:ü4'], 行: ['x:ing2', 'h:ang2'], 交: ['j:iao1'],
  通: ['t:ong1'], 安: [':an1'], 全: ['q:üan2'], 记: ['j:i4'],
  牢: ['l:ao2'], 谢: ['x:ie4'], 帮: ['b:ang1'], 助: ['zh:u4'],
  份: ['f:en4'], 礼: ['l:i3'], 物: [':u4'], 很: ['h:en3'],
  板: ['b:an3'], 四: ['s:i4'], 包: ['b:ao1'], 两: ['l:iang3'],
  豆: ['d:ou4'], 浆: ['j:iang1'], 高: ['g:ao1'], 兴: ['x:ing1', 'x:ing4'],
  地: ['d:i4', 'd:e0'], 向: ['x:iang4'], 操: ['c:ao1'],
  场: ['ch:ang3', 'ch:ang2'], 语: [':ü3'], 音: [':in1'],
  合: ['h:e2'], 成: ['ch:eng2'], 技: ['j:i4'], 术: ['sh:u4'],
  让: ['r:ang4'], 角: ['j:iao3', 'j:üe2'], 色: ['s:e4', 'sh:ai3'],
  能: ['n:eng2'], 够: ['g:ou4'], 口: ['k:ou3'], 型: ['x:ing2'],
  只: ['zh:i3', 'zh:i1'], 努: ['n:u3'], 力: ['l:i4'], 练: ['l:ian4'],
  习: ['x:i2'], 对: ['d:ui4'], 得: ['d:e2', 'd:e0', 'd:ei3'],
  准: ['zh:un3'], 从: ['c:ong2'], 前: ['q:ian2'], 有: [':iu3'],
  座: ['z:uo4'], 山: ['sh:an1'], 里: ['l:i3'], 庙: ['m:iao4'],
  梦: ['m:eng4'], 明: ['m:ing2'], 见: ['j:ian4'],

  // —— 基准词库扩充常用字 ——
  啊: [':a0', ':a1'], 爸: ['b:a4'], 哥: ['g:e1'], 姐: ['j:ie3'],
  弟: ['d:i4'], 妹: ['m:ei4'], 家: ['j:ia1'], 乡: ['x:iang1'],
  村: ['c:un1'], 路: ['l:u4'], 河: ['h:e2'], 海: ['h:ai3'],
  风: ['f:eng1'], 云: [':ün2'], 月: [':üe4'], 日: ['r:i4'],
  年: ['n:ian2'], 岁: ['s:ui4'], 分: ['f:en1'], 钟: ['zh:ong1'],
  时: ['sh:i2'], 课: ['k:e4'], 题: ['t:i2'], 生: ['sh:eng1'],
  工: ['g:ong1'], 作: ['z:uo4'], 厂: ['ch:ang3'], 商: ['sh:ang1'],
  店: ['d:ian4'], 饭: ['f:an4'], 菜: ['c:ai4'], 茶: ['ch:a2'],
  酒: ['j:iu3'], 糖: ['t:ang2'], 果: ['g:uo3'], 苹: ['p:ing2'],
  瓜: ['g:ua1'], 米: ['m:i3'], 鱼: [':ü2'], 肉: ['r:ou4'],
  鸡: ['j:i1'], 鸭: [':ia1'], 牛: ['n:iu2'], 羊: [':iang2'],
  猫: ['m:ao1'], 狗: ['g:ou3'], 虫: ['ch:ong2'], 草: ['c:ao3'],
  叶: [':ie4'], 蓝: ['l:an2'], 白: ['b:ai2'], 黑: ['h:ei1'],
  黄: ['h:uang2'], 多: ['d:uo1'], 少: ['sh:ao3'], 低: ['d:i1'],
  短: ['d:uan3'], 快: ['k:uai4'], 远: [':üan3'], 近: ['j:in4'],
  新: ['x:in1'], 旧: ['j:iu4'], 热: ['r:e4'], 冷: ['l:eng3'],
  暖: ['n:uan3'], 凉: ['l:iang2'], 东: ['d:ong1'], 西: ['x:i1'],
  南: ['n:an2'], 北: ['b:ei3'], 左: ['z:uo3'], 右: [':iu4'],
  外: [':uai4'], 旁: ['p:ang2'], 边: ['b:ian1'], 门: ['m:en2'],
  窗: ['ch:uang1'], 椅: [':i3'], 床: ['ch:uang2'], 视: ['sh:i4'],
  脑: ['n:ao3'], 手: ['sh:ou3'], 脚: ['j:iao3'], 头: ['t:ou2'],
  发: ['f:a1', 'f:a4'], 心: ['x:in1'], 耳: [':er3'], 目: ['m:u4'],
  牙: [':ia2'], 舌: ['sh:e2'], 朋: ['p:eng2'], 友: [':iu3'],
  客: ['k:e4'], 主: ['zh:u3'], 王: [':uang2'], 李: ['l:i3'],
  张: ['zh:ang1'], 刘: ['l:iu2'], 陈: ['ch:en2'], 杨: [':iang2'],
  赵: ['zh:ao4'], 周: ['zh:ou1'], 吴: [':u2'], 郑: ['zh:eng4'],
  孙: ['s:un1'], 钱: ['q:ian2'], 先: ['x:ian1'], 经: ['j:ing1'],
  常: ['ch:ang2'], 非: ['f:ei1'], 假: ['j:ia3', 'j:ia4'],
  错: ['c:uo4'], 难: ['n:an2', 'n:an4'], 易: [':i4'],
  忙: ['m:ang2'], 闲: ['x:ian2'], 累: ['l:ei4'], 困: ['k:un4'],
  笑: ['x:iao4'], 哭: ['k:u1'], 叫: ['j:iao4'], 喊: ['h:an3'],
  跳: ['t:iao4'], 坐: ['z:uo4'], 睡: ['sh:ui4'], 醒: ['x:ing3'],
  买: ['m:ai3'], 卖: ['m:ai4'], 给: ['g:ei3'], 拿: ['n:a2'],
  找: ['zh:ao3'], 读: ['d:u2'], 写: ['x:ie3'], 画: ['h:ua4'],
  飞: ['f:ei1'], 立: ['l:i4'], 躺: ['t:ang3'], 用: [':iong4'],
  关: ['g:uan1'], 推: ['t:ui1'], 拉: ['l:a1', 'l:a2'], 提: ['t:i2'],
  丢: ['d:iu1'], 捡: ['j:ian3'], 送: ['s:ong4'], 接: ['j:ie1'],
  过: ['g:uo4'], 进: ['j:in4'], 回: ['h:ui2'], 离: ['l:i2'],
  朝: ['ch:ao2', 'zh:ao1'], 沿: [':ian2'], 顺: ['sh:un4'],
  穿: ['ch:uan1'], 戴: ['d:ai4'], 洗: ['x:i3'], 刷: ['sh:ua1'],
  切: ['q:ie1', 'q:ie4'], 煮: ['zh:u3'], 炒: ['ch:ao3'],
  烤: ['k:ao3'], 端: ['d:uan1'], 尝: ['ch:ang2'], 闻: [':un2'],
  咬: [':iao3'], 吞: ['t:un1'], 知: ['zh:i1'], 道: ['d:ao4'],
  懂: ['d:ong3'], 认: ['r:en4'], 识: ['sh:i2', 'sh:i0'],
  会: ['h:ui4', 'k:uai4'], 教: ['j:iao1', 'j:iao4'], 考: ['k:ao3'],
  试: ['sh:i4'], 赢: [':ing2'], 输: ['sh:u1'], 乐: ['l:e4', ':üe4'],
  棋: ['q:i2'], 琴: ['q:in2'], 舞: [':u3'], 影: [':ing3'],
  剧: ['j:ü4'], 声: ['sh:eng1'], 响: ['x:iang3'], 词: ['c:i2'],
  句: ['j:ü4'], 字: ['z:i4'], 话: ['h:ua4'], 言: [':ian2'],
  文: [':un2'], 章: ['zh:ang1'], 段: ['d:uan4'], 篇: ['p:ian1'],
  页: [':ie4'], 本: ['b:en3'], 册: ['c:e4'], 纸: ['zh:i3'],
  笔: ['b:i3'], 墨: ['m:o4'], 信: ['x:in4'], 报: ['b:ao4'],
  杂: ['z:a2'], 广: ['g:uang3'], 告: ['g:ao4'], 牌: ['p:ai2'],
  旗: ['q:i2'], 光: ['g:uang1'], 彩: ['c:ai3'], 图: ['t:u2'],
  片: ['p:ian4', 'p:ian1'], 相: ['x:iang4', 'x:iang1'],
  机: ['j:i1'], 镜: ['j:ing4'], 框: ['k:uang4'], 架: ['j:ia4'],
  轮: ['l:un2'], 胎: ['t:ai1'], 船: ['ch:uan2'], 票: ['p:iao4'],
  桥: ['q:iao2'], 塔: ['t:a3'], 楼: ['l:ou2'], 屋: [':u1'],
  墙: ['q:iang2'], 瓦: [':ua3'], 砖: ['zh:uan1'], 线: ['x:ian4'],
  管: ['g:uan3'], 沟: ['g:ou1'], 井: ['j:ing3'], 坑: ['k:eng1'],
  洞: ['d:ong4'], 岛: ['d:ao3'], 湖: ['h:u2'], 泊: ['b:o2', 'p:o1'],
  溪: ['x:i1'], 泉: ['q:üan2'], 浪: ['l:ang4'], 潮: ['ch:ao2'],
  沙: ['sh:a1'], 石: ['sh:i2'], 土: ['t:u3'], 田: ['t:ian2'],
  金: ['j:in1'], 银: [':in2'], 铜: ['t:ong2'], 铁: ['t:ie3'],
  钢: ['g:ang1'], 玉: [':ü4'], 珠: ['zh:u1'], 宝: ['b:ao3'],
  钻: ['z:uan4', 'z:uan1'], 玻: ['b:o1'], 璃: ['l:i0', 'l:i2'],
  塑: ['s:u4'], 料: ['l:iao4'], 布: ['b:u4'], 丝: ['s:i1'],
  毛: ['m:ao2'], 皮: ['p:i2'], 革: ['g:e2'], 木: ['m:u4'],
  竹: ['zh:u2'], 根: ['g:en1'], 茎: ['j:ing1'], 种: ['zh:ong3', 'zh:ong4'],
  类: ['l:ei4'], 样: [':iang4'], 式: ['sh:i4'], 款: ['k:uan3'],
  套: ['t:ao4'], 组: ['z:u3'], 台: ['t:ai2'], 栋: ['d:ong4'],
  幢: ['ch:uang2'], 辆: ['l:iang4'], 艘: ['s:ou1'], 匹: ['p:i3'],
  支: ['zh:i1'], 颗: ['k:e1'], 粒: ['l:i4'], 滴: ['d:i1'],
  杯: ['b:ei1'], 瓶: ['p:ing2'], 盒: ['h:e2'], 袋: ['d:ai4'],
  箱: ['x:iang1'], 盆: ['p:en2'], 桶: ['t:ong3'], 锅: ['g:uo1'],
  盘: ['p:an2'], 筷: ['k:uai4'], 勺: ['sh:ao2'], 叉: ['ch:a1'],
  刀: ['d:ao1'], 铲: ['ch:an3'], 阿: [':a1', ':e1'], 谁: ['sh:ei2'],
  哪: ['n:a3'], 那: ['n:a4', 'n:ei4'], 些: ['x:ie1'],
  每: ['m:ei3'], 各: ['g:e4'], 另: ['l:ing4'], 半: ['b:an4'],
  满: ['m:an3'], 空: ['k:ong1', 'k:ong4'],
  深: ['sh:en1'], 浅: ['q:ian3'], 重: ['zh:ong4', 'ch:ong2'],
  轻: ['q:ing1'], 硬: [':ing4'], 软: ['r:uan3'],
  净: ['j:ing4'], 脏: ['z:ang1'], 早: ['z:ao3'],
  夏: ['x:ia4'], 秋: ['q:iu1'], 冬: ['d:ong1'],
  许: ['x:ü3'], 休: ['x:iu1'], 息: ['x:i1'], 什: ['sh:en2'],
  步: ['b:u4'], 确: ['q:üe4'], 亮: ['l:iang4'],
};

/**
 * 语境词表：最长匹配优先，解决多音字、轻声、变调语境。
 * key 是词，value 是与汉字等长的读音编码数组。
 */
export const WORDS: Record<string, EncodedReading[]> = {
  // 多音字语境
  长城: ['ch:ang2', 'ch:eng2'], 长大: ['zh:ang3', 'd:a4'],
  成长: ['ch:eng2', 'zh:ang3'], 银行: [':in2', 'h:ang2'],
  不行: ['b:u4', 'x:ing2'], 行人: ['x:ing2', 'r:en2'],
  一行: [':i1', 'h:ang2'], 重量: ['zh:ong4', 'l:iang4'],
  重新: ['ch:ong2', 'x:in1'], 觉得: ['j:üe2', 'd:e0'],
  睡觉: ['sh:ui4', 'j:iao4'], 感觉: ['g:an3', 'j:üe2'],
  角色: ['j:üe2', 's:e4'], 角落: ['j:iao3', 'l:uo4'],
  好看: ['h:ao3', 'k:an4'], 看门: ['k:an1', 'm:en2'],
  还有: ['h:ai2', ':iu3'], 还钱: ['h:uan2', 'q:ian2'],
  只有: ['zh:i3', ':iu3'], 一只: [':i1', 'zh:i1'],
  知道: ['zh:i1', 'd:ao4'], 地道: ['d:i4', 'd:ao4'],
  朝阳: ['ch:ao2', ':iang2'], 朝代: ['ch:ao2', 'd:ai4'],
  教室: ['j:iao4', 'sh:i4'], 教书: ['j:iao1', 'sh:u1'],
  音乐: [':in1', ':üe4'], 快乐: ['k:uai4', 'l:e4'],
  首都: ['sh:ou3', 'd:u1'], 都是: ['d:ou1', 'sh:i4'],
  中间: ['zh:ong1', 'j:ian1'], 中奖: ['zh:ong4', 'j:iang3'],
  房间: ['f:ang2', 'j:ian1'], 间断: ['j:ian4', 'd:uan4'],
  照片: ['zh:ao4', 'p:ian4'], 相片: ['x:iang4', 'p:ian4'],
  相信: ['x:iang1', 'x:in4'], 宰相: ['z:ai3', 'x:iang4'],
  假如: ['j:ia3', 'r:u2'], 放假: ['f:ang4', 'j:ia4'],
  灾难: ['z:ai1', 'n:an4'], 困难: ['k:un4', 'n:an2'],
  劳累: ['l:ao2', 'l:ei4'], 积累: ['j:i1', 'l:ei3'],
  发烧: ['f:a1', 'sh:ao1'], 头发: ['t:ou2', 'f:a4'],
  干净: ['g:an1', 'j:ing4'], 干活: ['g:an4', 'h:uo2'],
  种类: ['zh:ong3', 'l:ei4'], 种地: ['zh:ong4', 'd:i4'],
  空地: ['k:ong4', 'd:i4'], 空气: ['k:ong1', 'q:i4'],
  停泊: ['t:ing2', 'b:o2'], 湖泊: ['h:u2', 'p:o1'],
  钻石: ['z:uan4', 'sh:i2'], 钻研: ['z:uan1', ':ian2'],
  认识: ['r:en4', 'sh:i0'], 似的: ['sh:i4', 'd:e0'],
  是的: ['sh:i4', 'd:e0'], 得到: ['d:e2', 'd:ao4'],
  得去: ['d:ei3', 'q:ü4'], 跑得快: ['p:ao3', 'd:e0', 'k:uai4'],

  // 轻声词（结构助词、后缀、常用轻声）
  我们: [':uo3', 'm:en0'], 你们: ['n:i3', 'm:en0'],
  他们: ['t:a1', 'm:en0'], 她们: ['t:a1', 'm:en0'],
  孩子: ['h:ai2', 'z:i0'], 桌子: ['zh:uo1', 'z:i0'],
  椅子: [':i3', 'z:i0'], 本子: ['b:en3', 'z:i0'],
  包子: ['b:ao1', 'z:i0'], 饺子: ['j:iao3', 'z:i0'],
  样子: [':iang4', 'z:i0'], 个子: ['g:e4', 'z:i0'],
  这个: ['zh:e4', 'g:e0'], 那个: ['n:a4', 'g:e0'],
  怎么: ['z:en3', 'm:e0'], 什么: ['sh:en2', 'm:e0'],
  这么: ['zh:e4', 'm:e0'], 那么: ['n:a4', 'm:e0'],
  多么: ['d:uo1', 'm:e0'], 师傅: ['sh:i1', 'f:u0'],
  眼睛: [':ian3', 'j:ing0'], 妈妈: ['m:a1', 'm:a0'],
  爸爸: ['b:a4', 'b:a0'], 哥哥: ['g:e1', 'g:e0'],
  弟弟: ['d:i4', 'd:i0'], 妹妹: ['m:ei4', 'm:ei0'],
  星星: ['x:ing1', 'x:ing0'], 石头: ['sh:i2', 't:ou0'],
  木头: ['m:u4', 't:ou0'], 舌头: ['sh:e2', 't:ou0'],
  上面: ['sh:ang4', 'm:ian4'], 里面: ['l:i3', 'm:ian4'],
  外面: [':uai4', 'm:ian4'], 前面: ['q:ian2', 'm:ian4'],
  后面: ['h:ou4', 'm:ian4'], 玻璃: ['b:o1', 'l:i0'],
  休息: ['x:iu1', 'x:i0'], 明白: ['m:ing2', 'b:ai0'],
  凉快: ['l:iang2', 'k:uai0'], 喜欢: ['x:i3', 'h:uan1'],
  事情: ['sh:i4', 'q:ing2'], 记得: ['j:i4', 'd:e0'],
  看起来: ['k:an4', 'q:i3', 'l:ai0'], 起来: ['q:i3', 'l:ai0'],
  下来: ['x:ia4', 'l:ai0'], 出来: ['ch:u1', 'l:ai0'],
  过来: ['g:uo4', 'l:ai0'], 上去: ['sh:ang4', 'q:ü4'],
  朋友: ['p:eng2', ':iu3'], 晚上: [':uan3', 'sh:ang4'],
  早上: ['z:ao3', 'sh:ang4'], 路上: ['l:u4', 'sh:ang4'],

  // 样本句专用搭配
  火车站: ['h:uo3', 'ch:e1', 'zh:an4'],
  天安门: ['t:ian1', ':an1', 'm:en2'],
  老老实实: ['l:ao3', 'l:ao3', 'sh:i2', 'sh:i2'],
  高高兴兴: ['g:ao1', 'g:ao1', 'x:ing4', 'x:ing4'],
  交通安全: ['j:iao1', 't:ong1', ':an1', 'q:üan2'],
  语音合成: [':ü3', ':in1', 'h:e2', 'ch:eng2'],
  儿童: [':er2', 't:ong2'], 儿子: [':er2', 'z:i0'],
  婴儿: [':ing1', ':er2'], 女儿: ['n:ü3', ':er2'],
  幼儿: [':iu4', ':er2'], 儿科: [':er2', 'k:e1'],
};

/** 不参与儿化合并的「儿」字头词。 */
export const ERHUA_EXCEPTIONS = new Set([
  '儿童', '儿子', '儿女', '儿科', '婴儿', '女儿', '幼儿', '孤儿', '妻儿',
]);

/** 运行时追加的词典扩展（pinyinOverride / registerReadings 写入）。 */
const EXTRA_READINGS = new Map<string, EncodedReading[]>();
const EXTRA_WORDS = new Map<string, EncodedReading[]>();

export function registerReadings(map: Record<string, EncodedReading[]>): void {
  for (const [char, readings] of Object.entries(map)) {
    EXTRA_READINGS.set(char, readings);
  }
}

export function registerWords(map: Record<string, EncodedReading[]>): void {
  for (const [word, readings] of Object.entries(map)) {
    EXTRA_WORDS.set(word, readings);
  }
}

export function lookupChar(char: string): EncodedReading[] | undefined {
  return EXTRA_READINGS.get(char) ?? CHAR_READINGS[char];
}

export function lookupWord(word: string): EncodedReading[] | undefined {
  return EXTRA_WORDS.get(word) ?? WORDS[word];
}

/** 词典总字数（诊断用）。 */
export function dictionarySize(): number {
  return Object.keys(CHAR_READINGS).length + EXTRA_READINGS.size;
}
