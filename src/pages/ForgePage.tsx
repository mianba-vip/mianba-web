// 图谱锻造页：一句方向 → 后台批产概念树 → 人工审核（增删改/调层）→ 批准落库。
// 用户角色是「编辑者」：判断 AI 铺好的图要不要，而不是自己想出缺什么。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Hammer, Play, Check, X, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Button, Card, Tag } from '../components/ui';
import { forge, type ForgeConceptProposal, type ForgeRunSummary } from '../api/forge';
import { studyPlan } from '../api/drill';
import { getStoredUserId } from '../api/client';
import { useDashboardData, PLANS_ONLY } from '../lib/useDashboardData';
import type { PlanView } from '../api/types';
import './ForgePage.css';

const LAYER_LABEL: Record<number, string> = { 1: 'L1 概念', 2: 'L2 机制', 3: 'L3 实现', 4: 'L4 权衡', 5: 'L5 故障' };
const STATUS_LABEL: Record<string, string> = {
  PENDING: '排队中', RUNNING: '锻造中', AWAITING_REVIEW: '待审核',
  APPROVED: '已批准', REJECTED: '已拒绝', FAILED: '失败',
};

type Editable = ForgeConceptProposal & { _dropped?: boolean; _editing?: boolean };

export function ForgePage() {
  const [userId] = useState(() => getStoredUserId());
  const { data } = useDashboardData(userId, PLANS_ONLY);
  const plans: PlanView[] = data?.plans ?? [];
  const [searchParams] = useSearchParams();
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState('');
  // 锻造目标:'' 全局池 / 'new' 新建方向 / 已有方向 id 字符串
  const [planSel, setPlanSel] = useState<string>(() => {
    const q = searchParams.get('planId');
    if (q && Number(q) > 0) return q;
    return searchParams.get('new') === '1' ? 'new' : '';
  });
  const [planTitle, setPlanTitle] = useState('');   // planSel === 'new' 时的方向名
  const planId = planSel && planSel !== 'new' ? Number(planSel) : undefined;
  const [budget, setBudget] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 锻造记录按方向筛选:'' 全部 / 'global' 全局池 / 方向 id
  const [filterSel, setFilterSel] = useState('');

  const [runs, setRuns] = useState<ForgeRunSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('PENDING');
  const [concepts, setConcepts] = useState<Editable[]>([]);
  const [reportLine, setReportLine] = useState('');
  const [result, setResult] = useState('');
  const pollRef = useRef<number | null>(null);

  const loadRuns = useCallback(() => {
    forge.list().then(setRuns).catch(() => { /* 列表失败不阻塞 */ });
  }, []);

  useEffect(() => {
    loadRuns();
    // 从方向页/角标跳转进来时自动打开指定 run(如 ?run=42 待审核跳转)
    const runId = Number(searchParams.get('run'));
    if (Number.isSafeInteger(runId) && runId > 0) openRun(runId);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRuns]);

  // 轮询当前 run 直到终态/待审核
  const openRun = useCallback((id: number) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    setActiveId(id);
    setResult('');
    setErr('');
    const stopPolling = () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
    const poll = async () => {
      try {
        const v = await forge.get(id);
        setStatus(v.status);
        if (v.status === 'AWAITING_REVIEW' && v.concepts) {
          setConcepts(v.concepts.map((c) => ({ ...c, _dropped: false })));
          const r = v.report;
          setReportLine(r
            ? `${r.total} 个概念 · 批内去重 ${r.dropped_duplicate} · 与已有去重 ${r.dropped_existing}`
            : '');
          stopPolling();
        } else if (v.status === 'FAILED') {
          setErr(v.error || '锻造失败，请重试');
          stopPolling();
          loadRuns();
        } else if (v.status === 'APPROVED' || v.status === 'REJECTED') {
          // 从记录点开一条已终态的 run：展示结果后即停轮询
          setConcepts([]);
          setReportLine('');
          stopPolling();
          loadRuns();
        } else {
          setConcepts([]);
          setReportLine('');
        }
      } catch { /* 网络闪断：下轮再试 */ }
    };
    void poll();
    pollRef.current = window.setInterval(poll, 2500);
  }, [loadRuns]);

  const submit = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      // 「＋ 新建方向」:先建方向壳,再把锻造目标指到它;后续追加锻造沿用该方向
      let targetPlanId = planId;
      if (planSel === 'new') {
        const title = (planTitle.trim() || topic.split(/[,，;；。]/)[0].trim()).slice(0, 30);
        if (!title) { setErr('请填写新方向名（或从下拉选择已有方向）'); setBusy(false); return; }
        const plan = await studyPlan.create(title, goal.trim() || undefined);
        targetPlanId = plan.id;
        setPlanSel(String(plan.id));
        setPlanTitle('');
      }
      const { id } = await forge.create({ planId: targetPlanId, topic: topic.trim(), goal: goal.trim() || undefined, layerBudget: budget });
      setTopic(''); setGoal('');
      loadRuns();
      openRun(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '触发失败');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!activeId || busy) return;
    const kept = concepts.filter((c) => !c._dropped);
    if (kept.length === 0) { setErr('至少保留一条概念（或直接拒绝本次锻造）'); return; }
    setBusy(true);
    try {
      const r = await forge.approve(activeId, kept.map(({ _dropped, _editing, ...c }) => c));
      const skippedNote = r.skipped?.length ? `，${r.skipped.length} 条被去重跳过` : '';
      setResult(`已写入 ${r.created} 个概念${skippedNote}——去「学习计划」看看，今日任务马上就有题可练`);
      setStatus('APPROVED');
      if (pollRef.current) window.clearInterval(pollRef.current);
      loadRuns();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '批准失败');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!activeId || busy) return;
    setBusy(true);
    try {
      await forge.reject(activeId);
      setStatus('REJECTED');
      setResult('已拒绝，图谱未做任何改动');
      if (pollRef.current) window.clearInterval(pollRef.current);
      loadRuns();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const patch = (i: number, p: Partial<Editable>) =>
    setConcepts((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...p } : c)));

  const keptCount = concepts.filter((c) => !c._dropped).length;
  const shownRuns = filterSel === '' ? runs
    : filterSel === 'global' ? runs.filter((r) => r.planId == null)
    : runs.filter((r) => String(r.planId) === filterSel);

  return (
    <div className="forge-page">
      <header className="forge-head">
        <h1><Hammer size={20} /> 图谱锻造</h1>
        <p>一句话说出方向，AI 在后台把概念树铺好；你只需要修剪和批准——编辑比想出自己不知道什么容易得多。</p>
      </header>

      <Card className="forge-create">
        <div className="forge-form">
          <input
            className="forge-topic" placeholder="学习方向，如：JVM 调优，准备秋招"
            value={topic} onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
          <input className="forge-goal" placeholder="目标（可选），如：三周后面试"
            value={goal} onChange={(e) => setGoal(e.target.value)} />
          <select value={planSel} onChange={(e) => setPlanSel(e.target.value)}>
            <option value="">锻造到全局概念池</option>
            <option value="new">＋ 新建方向…</option>
            {plans.map((p) => <option key={p.id} value={String(p.id)}>锻造进「{p.title}」</option>)}
          </select>
          {planSel === 'new' && (
            <input
              className="forge-plan-title" placeholder="新方向名（可留空，取方向首段），如：JVM 调优"
              value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} />
          )}
          <select value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
            <option value={30}>轻量 30 个概念</option>
            <option value={50}>标准 50 个概念</option>
            <option value={80}>全面 80 个概念</option>
          </select>
          <Button onClick={submit} disabled={busy || !topic.trim()}><Play size={15} /> 开始锻造</Button>
        </div>
        {err && <div className="forge-err">{err}</div>}
      </Card>

      {runs.length > 0 && (
        <Card className="forge-runs">
          <div className="forge-runs-title">
            锻造记录
            <select className="forge-filter" value={filterSel} onChange={(e) => setFilterSel(e.target.value)}>
              <option value="">全部</option>
              <option value="global">全局概念池</option>
              {plans.map((p) => <option key={p.id} value={String(p.id)}>{p.title}</option>)}
            </select>
          </div>
          <div className="forge-runs-list">
            {shownRuns.length === 0 ? (
              <div className="forge-run-empty">该筛选下暂无锻造记录</div>
            ) : shownRuns.map((r) => {
              const plan = r.planId != null ? plans.find((p) => p.id === r.planId) : undefined;
              return (
                <button key={r.id} className={`forge-run-item${activeId === r.id ? ' active' : ''}`}
                  onClick={() => openRun(r.id)}>
                  <span className="forge-run-topic">{r.topic}</span>
                  {plan && <span className="forge-run-plan">{plan.title}</span>}
                  <Tag>{STATUS_LABEL[r.status] ?? r.status}</Tag>
                  {r.conceptCount > 0 && <span className="forge-run-count">{r.conceptCount} 概念</span>}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {activeId != null && (
        <Card className="forge-detail">
          {status === 'PENDING' || status === 'RUNNING' ? (
            <div className="forge-running">
              <RefreshCw size={16} className="spin" /> 锻造中：规划主题 → 并行起草 → 自检去重……
              通常 1~3 分钟，可以离开，回来接着审。
            </div>
          ) : status === 'AWAITING_REVIEW' ? (
            <>
              <div className="forge-review-head">
                <span>{reportLine}</span>
                <span className="forge-kept">保留 {keptCount} / {concepts.length}</span>
              </div>
              <div className="forge-list">
                {concepts.map((c, i) => (
                  <div key={i} className={`forge-concept${c._dropped ? ' dropped' : ''}`}>
                    {c._editing ? (
                      <div className="forge-edit">
                        <input value={c.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="名称" />
                        <textarea value={c.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder="描述" rows={2} />
                        <div className="forge-edit-row">
                          <select value={c.layer} onChange={(e) => patch(i, { layer: Number(e.target.value) })}>
                            {Object.entries(LAYER_LABEL).map(([l, t]) => <option key={l} value={l}>{t}</option>)}
                          </select>
                          <Button variant="ghost" onClick={() => patch(i, { _editing: false })}>完成</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="forge-c-main">
                          <span className="forge-c-name">{c.name}</span>
                          <span className="forge-c-desc">{c.description}</span>
                          {c.sub_points?.length > 0 && (
                            <span className="forge-c-subs">子点 {c.sub_points.length}：{c.sub_points.slice(0, 3).join('／')}{c.sub_points.length > 3 ? '…' : ''}</span>
                          )}
                        </div>
                        <Tag>{LAYER_LABEL[c.layer] ?? `L${c.layer}`}</Tag>
                        <span className="forge-c-topic">{c.topic}</span>
                        <div className="forge-c-ops">
                          <button title="编辑" onClick={() => patch(i, { _editing: true })}><Pencil size={14} /></button>
                          <button title={c._dropped ? '恢复' : '移除'}
                            onClick={() => patch(i, { _dropped: !c._dropped })}>
                            {c._dropped ? <RefreshCw size={14} /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="forge-actions">
                <Button onClick={approve} disabled={busy || keptCount === 0}><Check size={15} /> 批准并写入（{keptCount}）</Button>
                <Button variant="ghost" onClick={reject} disabled={busy}><X size={15} /> 全部不要</Button>
              </div>
            </>
          ) : (
            <div className="forge-final">
              {result || `本次锻造：${STATUS_LABEL[status] ?? status}`}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default ForgePage;
