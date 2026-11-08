import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Compass, Sparkles, X } from 'lucide-react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import WorkspaceBanner from './WorkspaceBanner';
import RouteLoadingFallback from './RouteLoadingFallback';
import RoleOnboardingTour from '../onboarding/RoleOnboardingTour';
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
  const [tourOpen, setTourOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try {
      return localStorage.getItem(`hiusa_tour_seen_${role}`) === 'true';
    } catch {
      return true;
    }
  });

  const dismissWelcome = useCallback(() => {
    setWelcomeDismissed(true);
    try {
      localStorage.setItem(`hiusa_tour_seen_${role}`, 'true');
    } catch {
      // storage unavailable
    }
  }, [role]);
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

  useEffect(() => {
    const openTour = () => setTourOpen(true);
    window.addEventListener('hiusa-open-onboarding-tour', openTour);
    return () => window.removeEventListener('hiusa-open-onboarding-tour', openTour);
  }, []);

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
    defaultHeader = <PageHeaderView className="mb-6" title={pageMeta.title} lead={pageMeta.isHome ? undefined : pageMeta.purpose} />;
  }

  return (
    <div className="flex h-[100dvh] max-w-full overflow-hidden bg-[#EEF6FB] font-sans text-[#0F172A]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} desktopCollapsed={desktopCollapsed} onToggleDesktop={toggleDesktopSidebar} />
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-[padding] duration-300 motion-reduce:transition-none ${desktopCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[260px]'}`}>
        <TopBar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <WorkspaceBanner />
        {isPlanningMode && (
          <aside aria-label="Planning" className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#F59E0B]/40 bg-amber-50 px-4 py-2 text-sm text-[#0F172A] sm:mx-6 sm:mt-3">
            <p className="min-w-0 break-words">
              You're planning <strong className="font-bold">AY {viewingPeriod.academic_year?.label} · {viewingPeriod.number === 1 ? '1st' : '2nd'} Semester</strong>. New events, tasks and requirements you add are saved to that period.
            </p>
            <Button variant="secondary" size="sm" onClick={handleReturnToLive}>Back to current semester</Button>
          </aside>
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6">
          <div className="route-fade-in">
            {pageMeta.isHome && !welcomeDismissed && (
              <aside
                aria-label="Welcome and tour guide"
                className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#0878B7]/30 bg-gradient-to-r from-[#EEF6FB] via-white to-[#EEF6FB] p-4 text-[#0F2F62] shadow-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0878B7] text-white shadow-xs" aria-hidden="true">
                    <Compass size={20} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-extrabold text-[#0B1831]">
                      Welcome to your HIUSA Workspace!
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600">
                      New here? Take an interactive 2-minute walkthrough covering your role tools, approvals, advance planning, and Ask AI copilot.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      dismissWelcome();
                      setTourOpen(true);
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0878B7] px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#0B1831] active:scale-[0.98]"
                  >
                    <Sparkles size={14} aria-hidden="true" />
                    <span>Start 2-Min Tour</span>
                  </button>
                  <button
                    type="button"
                    onClick={dismissWelcome}
                    aria-label="Dismiss welcome guide"
                    className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 active:scale-[0.98]"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </aside>
            )}
            {defaultHeader}
            <PageHeaderRegistryContext value={registry}>
              <div ref={contentRef}>
                <Suspense fallback={<RouteLoadingFallback />}>
                  <Outlet key={`${activeSubAccount?.id ? `sub-${activeSubAccount.id}` : 'master'}-${viewingPeriod?.id ?? 'live'}`} />
                </Suspense>
              </div>
            </PageHeaderRegistryContext>
          </div>
        </main>
      </div>
      <RoleOnboardingTour role={role || 'ADMIN'} open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
