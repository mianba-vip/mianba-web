// 选择题题干解析（src/lib/choice.ts）的行为验证：后端把选项内嵌在题干里，
// 前端要可靠地拆出 A-D 选项做按钮化作答，格式漂移时优雅退化。
import { parseChoiceStem, compactOptionsText } from '../src/lib/choice.ts';

const assert = (cond, msg) => {
  if (!cond) { console.error(`✗ ${msg}`); process.exitCode = 1; }
  else { console.log(`✓ ${msg}`); }
};

// 1. 标准四选项题干（后端 validChoice 约定的格式）
{
  const stem = '下列关于 JVM 内存结构的说法，哪一项是正确的？\nA. 堆内存线程私有\nB. 虚拟机栈线程私有\nC. 方法区存放对象实例\nD. 程序计数器随线程共享';
  const p = parseChoiceStem(stem);
  assert(p.hasChoice === true, '标准四选项：识别为选择题');
  assert(p.options.length === 4, `标准四选项：解析出 4 个选项（实际 ${p.options.length}）`);
  assert(p.options[1].key === 'B' && p.options[1].text === '虚拟机栈线程私有', '选项 B 文本正确');
  assert(p.body === '下列关于 JVM 内存结构的说法，哪一项是正确的？', '正文剥离选项行');
}

// 2. 选项行之间夹空行（模型常见排版）
{
  const stem = '问题？\n\nA. 甲\n\nB. 乙\n\nC. 丙\n\nD. 丁';
  const p = parseChoiceStem(stem);
  assert(p.hasChoice && p.options.length === 4, '空行分隔的选项仍完整解析');
  assert(p.body === '问题？', '空行分隔时正文正确');
}

// 3. 全角/中文分隔符
{
  const p = parseChoiceStem('题干\nA、甲\nB、乙');
  assert(p.hasChoice && p.options[0].text === '甲', '中文顿号分隔符可解析');
}

// 4. 正文里的枚举列表不应误判（只有 1 个字母行）
{
  const p = parseChoiceStem('实现 A. 先做缓存\n再考虑并发');
  assert(p.hasChoice === false, '单个枚举行不误判为选择题');
}

// 5. 格式漂移（无选项行）→ 退化
{
  const p = parseChoiceStem('请解释什么是 CAP 定理，并举例说明取舍。');
  assert(p.hasChoice === false && p.body.includes('CAP'), '文本题退化：原样返回正文');
}

// 6. 空题干
{
  const p = parseChoiceStem('');
  assert(p.hasChoice === false, '空题干安全退化');
}

// 7. 重复字母防御：取首个
{
  const p = parseChoiceStem('题\nA. 一\nA. 二\nB. 三');
  assert(p.options.length === 2 && p.options[0].text === '一', '重复字母取首个出现');
}

// 8. compactOptionsText：历史回显紧凑格式
{
  const stem = '题目\n\nA.  甲 \nB. 乙';
  const t = compactOptionsText(stem);
  assert(t === 'A. 甲\nB. 乙', `compact 回显格式（实际: ${JSON.stringify(t)}）`);
  assert(compactOptionsText('普通文本题') === null, '非选择题 compact 返回 null');
}

console.log('\nchoice.ts 测试完成');
