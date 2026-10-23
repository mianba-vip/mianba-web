// 知识图谱锻造（kg-forge）：一句方向 → sidecar 批产概念树提案 → 人工审核 → 落库。
// 提案由 LangGraph 图产出（checkpointer 断点续跑）；批准走后端确定性校验+去重后写库。
import { apiFetch } from './client';

export interface ForgeConceptProposal {
  name: string;
  description: string;
  topic: string;
  layer: number; // 1概念 2机制 3实现 4权衡 5故障
  sub_points: string[];
  source: string;
}

export interface ForgeCoverageReport {
  topic_layer: Record<string, Record<string, number>>;
  total: number;
  dropped_duplicate: number;
  dropped_existing: number;
}

export type ForgeStatus =
  | 'PENDING' | 'RUNNING' | 'AWAITING_REVIEW'
  | 'APPROVED' | 'REJECTED' | 'FAILED';

export interface ForgeRunView {
  id: number;
  status: ForgeStatus;
  concepts?: ForgeConceptProposal[];
  report?: ForgeCoverageReport;
  error?: string | null;
  conceptCount?: number;
}

export interface ForgeRunSummary {
  id: number;
  /** 锻造目标方向;null = 全局概念池 */
  planId: number | null;
  topic: string;
  status: ForgeStatus;
  conceptCount: number;
}

export const forge = {
  create: (body: { planId?: number; topic: string; goal?: string; layerBudget?: number }) =>
    apiFetch<{ id: number; threadId: string }>('/forge/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  list: () => apiFetch<ForgeRunSummary[]>('/forge/runs'),

  get: (id: number) => apiFetch<ForgeRunView>(`/forge/runs/${id}`),

  approve: (id: number, concepts: ForgeConceptProposal[]) =>
    apiFetch<{ created: number; skipped: { name: string; reason: string }[]; alreadyApproved?: boolean }>(
      `/forge/runs/${id}/approve`,
      { method: 'POST', body: JSON.stringify({ concepts }) },
    ),

  reject: (id: number) =>
    apiFetch<{ ok: boolean }>(`/forge/runs/${id}/reject`, { method: 'POST' }),
};
