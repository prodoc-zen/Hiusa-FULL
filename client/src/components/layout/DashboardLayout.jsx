import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import WorkspaceBanner from './WorkspaceBanner';
import RouteLoadingFallback from './RouteLoadingFallback';
import { PageHeaderView } from '../ui/PageHeader';
import { Button } from '../ui';
import { PageHeaderRegistryContext } from '../../lib/pageHeaderRegistry';
import { getPageMeta, getStoredRole } from '../../lib/pageMeta';
import { getActiveAcademicPeriod } from '../../services/systemAdministrationService';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import { PERIOD_EVENT, PERIOD_RESET_EVENT, readSelectedPeriod } from '../../utils/academicPeriodStore';

// A page that was not moved to PageHeader yet still writes its own h1. Watching the content for one
// keeps the default header from adding a second title above it.
function useContentHasHeading(contentRef, pathname) {
  const [hasHeading, setHasHeading] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;

    const check = () => setHasHeading(Boolean(content.querySelector('h1')));
    check();
    const observer = new MutationObserver(check);
    observer.observe(content, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentRef, pathname]);

  return hasHeading;
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hiusa_desktop_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [registeredHeaders, setRegisteredHeaders] = useState(0);
  const contentRef = useRef(null);
  const location = useLocation();
  const contentHasHeading = useContentHasHeading(contentRef, location.pathname);

  const register = useCallback(() => {
    setRegisteredHeaders((count) => count + 1);
    return () => setRegisteredHeaders((count) => count - 1);
  }, []);
  const registry = useMemo(() => ({ register }), [register]);

  const role = getStoredRole();
  const pageMeta = getPageMeta(location.pathname, role);
  const [viewingPeriod, setViewingPeriod] = useState(readSelectedPeriod);
  const [livePeriod, setLivePeriod] = useState(null);
  const { subAccount: activeSubAccount } = useActiveSubAccount();

  useEffect(() => {
    if (typeof getActiveAcademicPeriod === 'function') {
      getActiveAcademicPeriod().then(setLivePeriod).catch(() => setLivePeriod(null));
    }
    function handleSwitched(e) {
      setViewingPeriod(e.detail);
    }
    function handleReset() {
      setViewingPeriod(null);
    }
    window.addEventListener(PERIOD_EVENT, handleSwitched);
    window.addEventListener(PERIOD_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(PERIOD_EVENT, handleSwitched);
      window.removeEventListener(PERIOD_RESET_EVENT, handleReset);
    };
  }, []);

  function handleReturnToLive() {
    window.dispatchEvent(new CustomEvent(PERIOD_RESET_EVENT));
  }

  const isPlanningMode = Boolean(viewingPeriod && livePeriod && viewingPeriod.id !== livePeriod.id);

  function toggleDesktopSidebar() {
    setDesktopCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem('hiusa_desktop_sidebar_collapsed', String(next));
      } catch {
        // The rail still works when browser storage is unavailable.
      }
      return next;
    });
  }

  let defaultHeader = null;
  if (pageMeta.matched && registeredHeaders === 0 && !contentHasHeading) {
    defaultHeader = <PageHeaderView className="mb-6" title={pageMeta.title} />;
  }

  return (
    <div className="flex h-[100dvh] max-w-full overflow-hidden bg-page font-sans text-ink">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} desktopCollapsed={desktopCollapsed} onToggleDesktop={toggleDesktopSidebar} />
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-[padding] duration-300 motion-reduce:transition-none ${desktopCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[260px]'}`}>
        <TopBar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <WorkspaceBanner />
        {isPlanningMode && (
          <aside aria-label="Planning" className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning-tint px-4 py-2 text-sm text-ink sm:px-6">
            <p className="min-w-0 break-words">
              You're planning <strong className="font-semibold">AY {viewingPeriod.academic_year?.label} · {viewingPeriod.number === 1 ? '1st' : '2nd'} Semester</strong>. New events, tasks and requirements you add are saved to that period.
            </p>
            <Button variant="secondary" size="sm" onClick={handleReturnToLive}>Back to current semester</Button>
          </aside>
        )}
        <main className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6">
          {defaultHeader}
          <PageHeaderRegistryContext value={registry}>
            <div ref={contentRef}>
              <Suspense fallback={<RouteLoadingFallback />}>
                <Outlet key={`${activeSubAccount?.id ? `sub-${activeSubAccount.id}` : 'master'}-${viewingPeriod?.id ?? 'live'}`} />
              </Suspense>
            </div>
          </PageHeaderRegistryContext>
        </main>
      </div>
    </div>
  );
}
