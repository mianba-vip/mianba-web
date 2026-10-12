// 选择题（CHOICE）题干解析：后端把选项内嵌在题干文本里（A. xxx / B、xxx 行），
// meta.responseFormat === 'CHOICE' 时前端解析出选项做按钮化作答。
// 解析失败（模型格式漂移）时优雅退化：返回 hasChoice=false，按普通文本题渲染，
// 用户仍可在输入框手动输入字母（后端 GraderMcq 对字母作答有容错）。

export interface ChoiceOption {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export interface ParsedChoiceStem {
  /** 题干正文（选项行已剥离） */
  body: string;
  options: ChoiceOption[];
  /** false = 题干里没解析出合法选项行 → 退化为普通文本题 */
  hasChoice: boolean;
}

// 选项行：行首字母 A-D + 分隔符（./、/．/:/：/）+ 文本。与后端 validChoice 的
// 校验约定一致（题干内必须出现 A./B./C./D. 四个选项行）。
const OPTION_LINE = /^([A-D])[.、．:：]\s*(.+)$/;

/**
 * 从题干文本解析选项。约定：
 * - 选项行是「行首字母 + 分隔符」的行；连续的选项行块即选项区。
 * - 找到 ≥2 个字母互不重复的选项行才算成功（单行可能是正文里的枚举）。
 * - 题干正文 = 选项区之前的所有内容（题干通常以问题结尾，选项在末尾）。
 */
export function parseChoiceStem(stem: string): ParsedChoiceStem {
  if (!stem) return { body: '', options: [], hasChoice: false };
  const lines = stem.split('\n');
  const optionIdx = new Map<string, { key: 'A' | 'B' | 'C' | 'D'; text: string; line: number }>();

  lines.forEach((raw, i) => {
    const m = raw.trim().match(OPTION_LINE);
    if (!m) return;
    const key = m[1] as 'A' | 'B' | 'C' | 'D';
    const text = m[2].trim();
    if (!text) return;
    // 保留首字母在前的出现顺序信息；重复字母取首个（模型极少重复，防御）
    if (!optionIdx.has(key)) optionIdx.set(key, { key, text, line: i });
  });

  const found = [...optionIdx.values()].sort((a, b) => a.line - b.line);
  // 少于 2 个可信选项行 → 大概率是正文里的枚举列表，不是选择题选项
  if (found.length < 2) return { body: stem, options: [], hasChoice: false };

  // 选项区起点：首个选项行。选项区之后还可能有非选项行（罕见），一并归入正文尾部
  // 没有意义——按约定选项在题干末尾，正文 = 首个选项行之前的所有行。
  const firstLine = found[0].line;
  const body = lines.slice(0, firstLine).join('\n').trim();

  return {
    body,
    options: found.map(({ key, text }) => ({ key, text })),
    hasChoice: true,
  };
}

/**
 * 历史对话里的题干选项渲染：把选项行转换成「A. 文本」紧凑列表（去掉多余空白），
 * 供 DrillBubble 的历史气泡展示（不可交互，仅回显）。
 */
export function compactOptionsText(stem: string): string | null {
  const parsed = parseChoiceStem(stem);
  if (!parsed.hasChoice) return null;
  return parsed.options.map((o) => `${o.key}. ${o.text}`).join('\n');
}
