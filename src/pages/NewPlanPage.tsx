// 新建学习方向 · 双通道选择页：从已有文档对话规划 / 从知识图谱锻造。
// 不做功能，只做「选路」：文档通道带出资料快选，图谱通道带出生成入口与已有方向。
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpenText, Network, ArrowRight, Sparkles, FileStack } from 'lucide-react';
import { corpus } from '../api/drill';
import { getStoredUserId } from '../api/client';
import { useDashboardData, PLANS_ONLY } from '../lib/useDashboardData';
import type { CorpusView, PlanView } from '../api/types';
import './NewPlanPage.css';

export function NewPlanPage() {
  const navigate = useNavigate();
  const [userId] = useState(() => getStoredUserId());
  const { data } = useDashboardData(userId, PLANS_ONLY);
  const plans: PlanView[] = data?.plans ?? [];
  const [corpora, setCorpora] = useState<CorpusView[] | null>(null);

  useEffect(() => {
    let alive = true;
    corpus.list()
      .then((cs) => { if (alive) setCorpora(cs); })
      .catch(() => { if (alive) setCorpora([]); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="page new-plan-page">
      <header className="page-head">
        <h1>新建学习方向</h1>
        <p>两条路，同一个终点：把想学变成学会。</p>
      </header>

      <div className="np-grid">
        {/* ====== 通道一：从已有文档出发 ====== */}
        <section className="np-card np-card-doc">
          <div className="np-glow" aria-hidden />
          <div className="np-icon"><BookOpenText size={26} strokeWidth={1.7} /></div>
          <h2>从已有文档出发</h2>
          <p className="np-desc">
            选一本你上传的书或项目资料，AI 贴着原文和你对话，收敛出贴合材料的层级规划。
          </p>
          {corpora === null ? (
            <p className="np-hint">正在读取资料库…</p>
          ) : corpora.length === 0 ? (
            <p className="np-hint">还没有资料——可先去知识库上传，再回来从文档建方向。</p>
          ) : (
            <ul className="np-corpus">
              {corpora.slice(0, 3).map((c) => (
                <li key={c.id}>
                  <button onClick={() => navigate(`/intake?corpus=${c.id}`)} title={`基于《${c.name}》对话规划`}>
                    <FileStack size={14} strokeWidth={1.8} />
                    <span className="np-corpus-name">{c.name}</span>
                    <ArrowRight size={14} className="np-go" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="np-actions">
            <button className="np-cta" onClick={() => navigate('/intake')}>
              对话式规划 <ArrowRight size={16} strokeWidth={2} />
            </button>
            {corpora !== null && corpora.length === 0 && (
              <Link className="np-alt" to="/knowledge-base">先去上传资料 →</Link>
            )}
          </div>
        </section>

        {/* ====== 通道二：从知识图谱出发 ====== */}
        <section className="np-card np-card-forge">
          <div className="np-glow" aria-hidden />
          <div className="np-icon"><Network size={26} strokeWidth={1.7} /></div>
          <h2>从知识图谱出发</h2>
          <p className="np-desc">
            一句话说出方向，AI 在后台锻造「主题 × 层级」概念树，你审核修剪后落库——
            带先教后考的子知识点，批准即可开练。
          </p>
          {plans.length > 0 && (
            <div className="np-plans">
              <span className="np-plans-label">已有图谱 · 可继续锻造增量：</span>
              <div className="np-plan-chips">
                {plans.slice(0, 4).map((p) => (
                  <button key={p.id} className="np-plan-chip"
                    title={`往「${p.title}」追加锻造（自动对已有概念去重）`}
                    onClick={() => navigate(`/forge?planId=${p.id}`)}>
                    {p.title}<em>{p.totalCount} 概念</em>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="np-actions">
            <button className="np-cta np-cta-primary" onClick={() => navigate('/forge?new=1')}>
              <Sparkles size={16} strokeWidth={1.9} /> 生成知识图谱 <ArrowRight size={16} strokeWidth={2} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default NewPlanPage;
