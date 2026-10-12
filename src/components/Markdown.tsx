import { memo, useEffect, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import './Markdown.css';
// 高频语言静态注册（进入主包，首帧即高亮——流式聊天代码块不需要等异步加载）；
// 冷门语言走 LAZY_LANGUAGES 按需注册（独立小 chunk，首次出现该语言代码块时拉取），
// 避免把 33 种语言全部打进主包。
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';

const REGISTERED: [string, unknown][] = [
  ['javascript', javascript], ['typescript', typescript],
  ['jsx', jsx], ['tsx', tsx], ['python', python], ['bash', bash],
  ['json', json], ['sql', sql], ['yaml', yaml], ['java', java],
  ['go', go], ['markup', markup], ['css', css],
];
for (const [name, lang] of REGISTERED) {
  SyntaxHighlighter.registerLanguage(name, lang as Parameters<typeof SyntaxHighlighter.registerLanguage>[1]);
}

// 冷门语言：首次遇到才动态 import 注册（各成独立小 chunk）。registered 标记
// 去重；加载完成前该代码块以纯文本渲染（SyntaxHighlighter 未注册语言不报错），
// LangReadyGate 里 bump 状态触发重渲染后恢复高亮。
const LAZY_LANGUAGES: Record<string, () => Promise<{ default: unknown }>> = {
  scss: () => import('react-syntax-highlighter/dist/esm/languages/prism/scss'),
  rust: () => import('react-syntax-highlighter/dist/esm/languages/prism/rust'),
  kotlin: () => import('react-syntax-highlighter/dist/esm/languages/prism/kotlin'),
  swift: () => import('react-syntax-highlighter/dist/esm/languages/prism/swift'),
  cpp: () => import('react-syntax-highlighter/dist/esm/languages/prism/cpp'),
  csharp: () => import('react-syntax-highlighter/dist/esm/languages/prism/csharp'),
  php: () => import('react-syntax-highlighter/dist/esm/languages/prism/php'),
  ruby: () => import('react-syntax-highlighter/dist/esm/languages/prism/ruby'),
  diff: () => import('react-syntax-highlighter/dist/esm/languages/prism/diff'),
  docker: () => import('react-syntax-highlighter/dist/esm/languages/prism/docker'),
  graphql: () => import('react-syntax-highlighter/dist/esm/languages/prism/graphql'),
  markdown: () => import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
  toml: () => import('react-syntax-highlighter/dist/esm/languages/prism/toml'),
  ini: () => import('react-syntax-highlighter/dist/esm/languages/prism/ini'),
  properties: () => import('react-syntax-highlighter/dist/esm/languages/prism/properties'),
  scala: () => import('react-syntax-highlighter/dist/esm/languages/prism/scala'),
  dart: () => import('react-syntax-highlighter/dist/esm/languages/prism/dart'),
  elixir: () => import('react-syntax-highlighter/dist/esm/languages/prism/elixir'),
  haskell: () => import('react-syntax-highlighter/dist/esm/languages/prism/haskell'),
  lua: () => import('react-syntax-highlighter/dist/esm/languages/prism/lua'),
  perl: () => import('react-syntax-highlighter/dist/esm/languages/prism/perl'),
  r: () => import('react-syntax-highlighter/dist/esm/languages/prism/r'),
};
const lazyLangLoaded = new Set<string>();

/** 冷门语言按需注册的守门组件：注册完成后重渲染一次，恢复语法高亮。 */
function LangReadyGate({ lang, children }: { lang: string; children: React.ReactNode }) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (lazyLangLoaded.has(lang)) return;
    const loader = LAZY_LANGUAGES[lang];
    if (!loader) return;
    let active = true;
    loader().then((mod) => {
      SyntaxHighlighter.registerLanguage(lang, mod.default as Parameters<typeof SyntaxHighlighter.registerLanguage>[1]);
      lazyLangLoaded.add(lang);
      if (active) bump((n) => n + 1);
    }).catch(() => { /* 拉取失败：保持纯文本渲染 */ });
    return () => { active = false; };
  }, [lang]);
  return <>{children}</>;
}

// 安全渲染：react-markdown 默认不渲染原始 HTML（转义），配合下面不放行
// rehype-raw，可天然规避 XSS。链接强制新标签 + noopener，避免反向劫持。

// md 里常见语言别名 → refractor（PrismAsyncLight 的语言加载器）真实 ID。
// 只映射"别名 ≠ 加载器 ID"的情况，其余（go / java / python / rust…）原样透传。
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  'c++': 'cpp',
  'c#': 'csharp',
  sh: 'bash',
  shell: 'bash',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  k8s: 'yaml',
  dockerfile: 'docker',
};

/** 代码块右上角语言角标（仅对常见语言显示；不认识的不显示，不猜）。 */
const LANG_LABEL: Record<string, string> = {
  go: 'Go',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  python: 'Python',
  bash: 'Bash',
  json: 'JSON',
  sql: 'SQL',
  yaml: 'YAML',
  markdown: 'Markdown',
  markup: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  java: 'Java',
  rust: 'Rust',
  kotlin: 'Kotlin',
  swift: 'Swift',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  diff: 'Diff',
  docker: 'Docker',
  graphql: 'GraphQL',
  toml: 'TOML',
  ini: 'INI',
  properties: 'Properties',
  scala: 'Scala',
  dart: 'Dart',
  elixir: 'Elixir',
  haskell: 'Haskell',
  lua: 'Lua',
  perl: 'Perl',
  r: 'R',
};

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 非 HTTPS、WebView 权限受限等情况继续走兼容复制。
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('复制失败');
}

function CodeToolbar({ text, label = 'Code' }: { text: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async () => {
    try {
      await copyText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    window.setTimeout(() => setStatus('idle'), 1800);
  };

  const title = status === 'copied'
    ? '已复制'
    : status === 'failed'
      ? '复制失败，请手动选择代码'
      : '复制代码';

  return (
    <div className="md-code-toolbar">
      <span className="md-code-lang">{label}</span>
      <button
        type="button"
        className={`md-code-copy${status === 'failed' ? ' is-failed' : ''}`}
        onClick={handleCopy}
        title={title}
        aria-label={title}
      >
        {status === 'copied' ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

function removeMermaidArtifacts(id: string) {
  // mermaid.render() 默认把临时 SVG 挂到 document.body。解析失败时旧版本可能来不及自行移除，
  // 因而页面底部会残留“Syntax error in text”。这里成功、失败和卸载时都做兜底清理。
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
  document.getElementById(`i${id}`)?.remove();
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let renderId = '';
    let retryTimer = 0;
    let guardTimer = 0;
    let settled = false;
    setSvg('');
    setFailed(false);

    // 聊天内容是逐 token 到达的。若立即绘图，半截的 flowchart/sequenceDiagram 会被 Mermaid
    // 当成语法错误；等内容短暂停止变化后再绘制，避免一次回复产生几十个失败 SVG。
    const timer = window.setTimeout(() => draw(false), 450);

    // 清洗：剥掉 AI 偶发裹在图源外层的 ``` 围栏与首尾杂行，只留图本体。
    const clean = source
      .trim()
      .replace(/^```[a-zA-Z]*\s*\n/, '')
      .replace(/\n?```\s*$/, '')
      .trim();

    function draw(isRetry: boolean) {
      import('mermaid').then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          // antiscript：允许 AI 生成的图使用 <br> 等 HTML 标签（strict 在 v11 下对部分含
          // HTML 标签的图渲染失败），同时仍过滤 script 注入，比 loose 安全。
          securityLevel: 'antiscript',
          theme: 'neutral',
          // 解析失败只抛异常给组件回退，不让 Mermaid 在 body 中绘制炸弹错误图。
          suppressErrorRendering: true,
        });
        renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}${isRetry ? 'r' : ''}`;
        return mermaid.render(renderId, clean);
      }).then(({ svg: rendered }) => {
        settled = true;
        if (active) setSvg(rendered);
      }).catch((err) => {
        console.warn('[mermaid] render failed' + (isRetry ? ' (after retry)' : ''), err);
        if (!active) return;
        // 一次性竞态（连续 source 变更打断、并发渲染排队超时）很常见：隔 1s 重试一次，仍失败才回退源码。
        if (!isRetry) retryTimer = window.setTimeout(() => draw(true), 1000);
        else {
          settled = true;
          setFailed(true);
        }
      }).finally(() => {
        if (renderId) removeMermaidArtifacts(renderId);
      });
    }

    // 兜底：12s 仍未出图（动态导入卡死/渲染悬挂）→ 回退源码，避免永久停在“正在绘制…”。
    guardTimer = window.setTimeout(() => {
      if (active && !settled) {
        settled = true;
        setFailed(true);
      }
    }, 12000);

    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(guardTimer);
      if (renderId) removeMermaidArtifacts(renderId);
    };
  }, [reactId, source]);

  if (svg) {
    return <div className="md-diagram" role="img" aria-label="AI 生成的示意图" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  if (!failed) return <div className="md-diagram-loading">正在绘制示意图…</div>;
  return <pre className="md-diagram-fallback"><code>{source}</code></pre>;
}

const components: Components = {
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
  // 长表格包一层横向滚动容器（.md-table-wrap），避免撑破聊天气泡。
  // 只对顶级 table 包裹，套住整个表；内层仍由 browser 渲染。
  table: ({ node, ...props }) => (
    <div className="md-table-wrap"><table {...props} /></div>
  ),
  // react-markdown 默认用 <pre> 包裹代码块；我们的 code 组件已自管结构（高亮 div / 原生 pre），
  // 拆掉外层 pre 避免套出两层方框（.md pre 的背景/边框会再裹一层）。
  pre: ({ children }) => <>{children}</>,
  // 块级代码（```lang …```）→ 语法高亮 + 语言角标；
  // 无语言标注的代码块 → 保持原生 pre（浅色底纹）；行内 code → 原生 code。
  code: ({ className, children, node, ...props }) => {
    const raw = String(children);
    const text = raw.replace(/\n$/, ''); // 去掉 Prism 渲染时多余的尾换行
    const match = /language-([\w+#-]+)/.exec(className ?? '');

    if (match) {
      const requestedLang = match[1].toLowerCase();
      if (requestedLang === 'mermaid') {
        return (
          <div className="md-code-block">
            <CodeToolbar text={text} label="Mermaid" />
            <MermaidDiagram source={text} />
          </div>
        );
      }
      const lang = (LANG_ALIAS[requestedLang] ?? requestedLang).toLowerCase();
      const label = LANG_LABEL[lang];
      const needsLazy = !lazyLangLoaded.has(lang) && lang in LAZY_LANGUAGES;
      return (
        <div className="md-code-block">
          <CodeToolbar text={text} label={label ?? requestedLang} />
          {/* 冷门语言首现时先纯文本渲染，LangReadyGate 注册后重渲染出高亮 */}
          {needsLazy ? (
            <LangReadyGate lang={lang}>
              <pre className="md-plain-code"><code>{text}</code></pre>
            </LangReadyGate>
          ) : (
            <SyntaxHighlighter
              language={lang}
              style={oneLight}
              PreTag="div"
              customStyle={{
                margin: 0,
                padding: 'var(--s-3) var(--s-4)',
                borderRadius: 'var(--r-md)',
                background: 'color-mix(in oklch, var(--ink) 6%, transparent)',
                border: '1px solid color-mix(in oklch, var(--ink) 12%, transparent)',
                fontSize: 'calc(0.85em * var(--scale-code, 1))',
                lineHeight: 1.6,
              }}
              codeTagProps={{
                style: {
                  fontFamily: 'var(--font-mono)',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  // 未命中 token 的裸文本继承正文色（--ink），避免染上 .md code 的朱砂红
                  color: 'inherit',
                },
              }}
            >
              {text}
            </SyntaxHighlighter>
          )}
        </div>
      );
    }

    // 无语言标注的多行块：补回 pre 结构，走 .md pre 的浅色底纹样式
    // （用原始文本判断换行，避免去掉尾换行后误判为行内 code）
    if (raw.includes('\n')) {
      return (
        <div className="md-code-block">
          <CodeToolbar text={text} />
          <pre className={className}>
            <code {...props}>{children}</code>
          </pre>
        </div>
      );
    }
    return <code className={className} {...props}>{children}</code>;
  },
};

/**
 * 把 markdown 文本安全渲染为富文本。用于 AI 生成的聊天气泡（题干 / 讲解 / 追问），
 * 让用户看到的代码块、列表、加粗、表格等结构正常呈现。
 * 代码块带语言时做语法高亮（高频语言随主包注册；冷门语言按需加载；
 * 未注册语言自动降级纯文本）。
 *
 * memo：聊天线程里每个 token 到达都会重渲染父级，Markdown 文本未变的气泡
 * （历史消息）重复解析 AST 是主要浪费；children 不变即跳过整棵渲染树。
 */
export const Markdown = memo(function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`md${className ? ' ' + className : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
