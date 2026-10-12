// 选择题选项按钮：CHOICE 题的按钮化作答（点击/键盘 A-D 即发送字母作答）。
// 退化保护：parseChoiceStem 解析失败时由调用方隐藏本组件（hasChoice=false），
// 用户仍可手动输入字母（后端 GraderMcq 对字母作答有容错）。
import { useEffect } from 'react';
import type { ChoiceOption } from '../lib/choice';

interface Props {
  options: ChoiceOption[];
  disabled?: boolean;   // AI 流式回复 / 已评分等阶段禁用
  /** 用户点选某选项：发送字母作答（与手动输入"B"走同一条 chat 链路） */
  onPick: (key: ChoiceOption['key']) => void;
}

const KEYS = ['A', 'B', 'C', 'D'] as const;

export function ChoiceOptions({ options, disabled, onPick }: Props) {
  // 键盘快捷键：单按 A-D 直接选（输入框聚焦时不拦截——避免和打字冲突；
  // 输入框为空且未聚焦时才生效，具体判断见 keydown 处理）
  useEffect(() => {
    if (disabled || options.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // 输入类控件聚焦时不拦截字母键（CodeMirror/textarea/input）
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.closest('.cm-editor')) return;   // CodeMirror 宿主
      const key = e.key.toUpperCase();
      if ((KEYS as readonly string[]).includes(key) && options.some((o) => o.key === key)) {
        e.preventDefault();
        onPick(key as ChoiceOption['key']);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, disabled, onPick]);

  return (
    <div className="choice-options" role="group" aria-label="选择题选项">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className="choice-option"
          disabled={disabled}
          onClick={() => onPick(o.key)}
        >
          <span className="choice-option-key">{o.key}</span>
          <span className="choice-option-text">{o.text}</span>
        </button>
      ))}
      <div className="choice-options-hint">点击选项或按 A–D 键作答；也可先在输入框写理由再点选项</div>
    </div>
  );
}
