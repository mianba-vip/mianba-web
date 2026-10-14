import { memo } from 'react';
import { fmt, ReasoningPanel, type ChatMsg } from './DrillChatBits';
import { Timer } from 'lucide-react';
import { Tag } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { PROBE_LABEL } from '../lib/labels';
import type { QuestionMeta } from '../api/types';
import { parseChoiceStem } from '../lib/choice';

/** 聊天气泡渲染（含思考过程折叠面板与逐字光标）。从 Drill.tsx 拆出。
 *
 * memo：聊天线程里每个 token 到达都会重渲染整个 messages 列表，未在流式中的
 * 历史气泡（文本/props 均不变）重复解析是纯浪费；streaming 气泡因 text 变化
 * 仍每次重渲染，不受影响。 */
export const ChatBubble = memo(function ChatBubble({
  msg: m,
  meta,
  timingOn,
  seconds,
  onPickChoice,
  choiceDisabled,
  correctKeys,
  pickedKey,
}: {
  msg: ChatMsg;
  meta: QuestionMeta | null;
  timingOn: boolean;
  seconds: number;
  /** CHOICE 题选某选项（题干气泡内嵌选项按钮；历史/浏览态不传即纯展示） */
  onPickChoice?: (key: 'A' | 'B' | 'C' | 'D') => void;
  /** 选项按钮禁用（AI 流式回复 / 已评分等） */
  choiceDisabled?: boolean;
  /** 判分后下发的正确项字母（B2 选项级对照）；非判分态不传 */
  correctKeys?: string;
  /** 本轮用户点选/作答的字母（对照时标红自己的错选） */
  pickedKey?: string;
}) {
  // 思考中 / 生成中：streaming 且还没出字
  const isThinking = m.streaming && !m.text;
  const thinkingText = m.type === 'stem' ? '正在生成题目…' : '思考中…';

  // 选择题：解析题干内嵌的 A-D 选项。仅在「当前活跃题 + CHOICE + 解析成功」时
  // 启用按钮化作答；历史气泡（浏览/继续练习）只做纯文本回显，不重复作答。
  const choice = m.type === 'stem' && meta?.responseFormat === 'CHOICE' && !isThinking
    ? parseChoiceStem(m.text)
    : null;
  // 判分后（correctKeys 有值）也渲染选项区：不可再选，但做「你选了 X / 正确答案 Y」对照
  const showChoiceButtons = choice?.hasChoice === true && (!!onPickChoice || !!correctKeys);

  const rowCls = isThinking
    ? `chat-row chat-row-${m.role} chat-row-loading`
    : `chat-row chat-row-${m.role}`;
  const bubbleCls =
    `chat-bubble chat-bubble-${m.role}` +
    (m.type === 'stem' ? ' is-stem' : '') +
    (m.type === 'chat' && m.role === 'ai' && !isThinking ? ' is-tutor' : '') +
    (isThinking ? ' is-loading' : '');

  return (
    <div className={rowCls}>
      {m.role === 'ai' && (
        <div className="chat-avatar chat-avatar-ai"><span>AI</span></div>
      )}
      <div className={bubbleCls}>
        {/* 题干 meta 信息（probe type / runId / 计时）*/}
        {m.type === 'stem' && meta && (
          <div className="chat-stem-meta">
            <Tag>{PROBE_LABEL[meta.probeType] ?? meta.probeType}</Tag>
            <span className="eyebrow">run #{meta.runId}</span>
            {timingOn && (
              <span className="timer-chip">
                <Timer size={14} strokeWidth={1.8} /> {fmt(seconds)}
              </span>
            )}
          </div>
        )}
        {isThinking ? (
          <>
            <span className="spinner-sm" /> {thinkingText}
          </>
        ) : m.type === 'stem' ? (
          // 题干不走 tutor-text（避免"讲解 ·"前缀）；思考过程流式展示（默认展开，markdown）。
          // 选择题：题干只渲染正文（选项行剥离为按钮），解析失败则整段原文渲染（优雅退化）。
          <>
            {m.reasoning && <ReasoningPanel text={m.reasoning} active={m.streaming} />}
            <Markdown>{showChoiceButtons ? (choice?.body ?? m.text) : m.text}</Markdown>
            {showChoiceButtons && choice && (
              <div className="choice-options" role="group" aria-label="选择题选项">
                {choice.options.map((o) => {
                  const isCorrect = !!correctKeys?.includes(o.key);
                  const isWrongPick = !!correctKeys && pickedKey === o.key && !isCorrect;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      className={`choice-option${isCorrect ? ' is-correct' : ''}${isWrongPick ? ' is-wrong-pick' : ''}`}
                      disabled={choiceDisabled || !onPickChoice}
                      onClick={() => onPickChoice?.(o.key)}
                    >
                      <span className="choice-option-key">{o.key}{isCorrect ? ' ✓' : isWrongPick ? ' ✗' : ''}</span>
                      <span className="choice-option-text">{o.text}</span>
                    </button>
                  );
                })}
                {correctKeys ? (
                  <div className="choice-options-hint choice-verdict-hint">
                    你选了 <b>{pickedKey ?? '—'}</b> · 正确答案 <b>{correctKeys}</b>
                    {pickedKey && correctKeys.includes(pickedKey) ? '，答对了' : '，答错了——看看下方评分细则漏在哪'}
                  </div>
                ) : (
                  <div className="choice-options-hint">点击选项或按 A–D 键作答（输入框有字时连同理由一起发送）</div>
                )}
              </div>
            )}
            {m.streaming && <span className="tutor-caret" aria-hidden />}
          </>
        ) : m.role === 'ai' ? (
          // AI 对话回复走 tutor-text 样式；思考过程流式展示（默认展开，markdown），正文保持干净。
          // revealed=true（答案已揭示）时在气泡顶部渲染「参考答案」分隔线。
          <>
            {m.revealed && (
              <div className="chat-reveal-divider">
                <span>参考答案 · 此后的回答不再计入评分</span>
              </div>
            )}
            <div className="tutor-text">
            {m.reasoning && <ReasoningPanel text={m.reasoning} active={m.streaming} />}
            <Markdown>{m.text}</Markdown>
            {m.streaming && <span className="tutor-caret" aria-hidden />}
          </div>
          {m.paused && (
            <div className="chat-paused-note">⏸ 已暂停：未答完的回复未保存，可继续提问</div>
          )}
          </>
        ) : (
          // 用户自己的消息：Markdown 渲染（与 AI 同款），贴的代码自动高亮；图片原样展示
          <div className="me-text">
            {m.images && m.images.length > 0 && (
              <div className="chat-img-row">
                {m.images.map((src, i) => <img key={i} src={src} alt={`消息图片 ${i + 1}`} loading="lazy" />)}
              </div>
            )}
            <Markdown>{m.text}</Markdown>
          </div>
        )}
      </div>
      {m.role === 'me' && (
        <div className="chat-avatar chat-avatar-me"><span>我</span></div>
      )}
    </div>
  );
});

// —— 应用内确认弹窗（Electron 不支持 window.confirm/prompt，必须用组件弹窗）——
