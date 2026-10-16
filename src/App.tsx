import type { ReactNode } from 'react';
import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
// 首页是登录后的落地页：保持静态（首屏直出，无 lazy 闪烁）；其余页面按路由分包，
// 主包只含 AppShell + Dashboard，冷页面（面试/简历/知识库/设置…）首次访问才加载。
import { Dashboard } from './pages/Dashboard';

const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Drill = lazy(() => import('./pages/Drill').then((m) => ({ default: m.Drill })));
const Interview = lazy(() => import('./pages/Interview').then((m) => ({ default: m.Interview })));
const InterviewHistory = lazy(() => import('./pages/InterviewHistory').then((m) => ({ default: m.InterviewHistory })));
const InterviewDetail = lazy(() => import('./pages/InterviewDetail').then((m) => ({ default: m.InterviewDetail })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Notes = lazy(() => import('./pages/Notes').then((m) => ({ default: m.Notes })));
const ReviewPage = lazy(() => import('./pages/Review').then((m) => ({ default: m.ReviewPage })));
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.HistoryPage })));
const PlansPage = lazy(() => import('./pages/PlansPage').then((m) => ({ default: m.PlansPage })));
const IntakeChat = lazy(() => import('./pages/IntakeChat').then((m) => ({ default: m.IntakeChat })));
const ForgePage = lazy(() => import('./pages/ForgePage').then((m) => ({ default: m.ForgePage })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const CapturePage = lazy(() => import('./pages/CapturePage').then((m) => ({ default: m.CapturePage })));
const ResumeManagement = lazy(() => import('./pages/ResumeManagement').then((m) => ({ default: m.ResumeManagement })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const KnowledgeBasePage = lazy(() => import('./pages/KnowledgeBasePage').then((m) => ({ default: m.KnowledgeBasePage })));
const KnowledgeToolsPage = lazy(() => import('./pages/KnowledgeToolsPage').then((m) => ({ default: m.KnowledgeToolsPage })));

/** 路由级代码分包的加载占位：与 AppShell 侧栏共存，居中一个小 spinner。 */
function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-label="页面加载中">
      <span className="spinner" />
    </div>
  );
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { authReady, userId } = useAuth();
  if (!authReady) return null;
  return userId ? <>{children}</> : <Navigate to="/login" replace />;
}

/** 受保护路由：RequireAuth（会话就绪且已登录）→ Suspense（页面分包加载）→ AppShell。 */
function Guarded({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <LazyPage>{children}</LazyPage>
      </AppShell>
    </RequireAuth>
  );
}

export function App() {
  const { authReady, userId } = useAuth();
  // 已保存的 token 必须先通过云端/本地后端验证；校验期间不挂载 AppShell，
  // 避免侧栏、主页等组件抢先请求用户设置。
  if (!authReady) return null;
  return (
    <Routes>
      <Route
        path="/login"
        element={userId ? <Navigate to="/" replace /> : (
          <Suspense fallback={<PageLoading />}><Login /></Suspense>
        )}
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell>
              <Dashboard />
            </AppShell>
          </RequireAuth>
        }
      />
      {/* /drill/* 让 Drill 在子路由间保持挂载（视图由路径派生，支持前进/后退） */}
      <Route path="/drill/*" element={<Guarded><Drill /></Guarded>} />
      <Route path="/intake" element={<Guarded><IntakeChat /></Guarded>} />
      <Route path="/resumes" element={<Guarded><ResumeManagement /></Guarded>} />
      <Route path="/rehearsal" element={<Guarded><Interview /></Guarded>} />
      <Route path="/rehearsal/history" element={<Guarded><InterviewHistory /></Guarded>} />
      <Route path="/rehearsal/history/:id" element={<Guarded><InterviewDetail /></Guarded>} />
      <Route path="/profile" element={<Guarded><Profile /></Guarded>} />
      <Route path="/notes" element={<Guarded><Notes /></Guarded>} />
      <Route path="/notes/review/:runId" element={<Guarded><ReviewPage /></Guarded>} />
      <Route path="/plan" element={<Guarded><PlansPage /></Guarded>} />
      <Route path="/forge" element={<Guarded><ForgePage /></Guarded>} />
      <Route path="/history" element={<Guarded><HistoryPage /></Guarded>} />
      <Route path="/knowledge-base" element={<Guarded><KnowledgeBasePage /></Guarded>} />
      <Route path="/knowledge-base/tools" element={<Guarded><KnowledgeToolsPage /></Guarded>} />
      <Route path="/account" element={<Guarded><AccountPage /></Guarded>} />
      <Route path="/knowledge-base/:id" element={<Guarded><KnowledgeBasePage /></Guarded>} />
      <Route path="/knowledge-base/import" element={<Navigate to="/knowledge-base" replace />} />
      <Route path="/settings" element={<Guarded><Settings /></Guarded>} />
      <Route path="/capture" element={<Guarded><CapturePage /></Guarded>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
