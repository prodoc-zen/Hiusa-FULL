import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import RouteLoadingFallback from './RouteLoadingFallback';
import RoleOnboardingTour from '../onboarding/RoleOnboardingTour';
import { PageBreadcrumb, PageHeaderView } from '../ui/PageHeader';
import { PageHeaderRegistryContext } from '../../lib/pageHeaderRegistry';
import { getBreadcrumbs, getPageMeta, getStoredRole } from '../../lib/pageMeta';
import { getActiveAcademicPeriod } from '../../services/systemAdministrationService';

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
  const breadcrumbs = getBreadcrumbs(location.pathname, role);
  const [tourOpen, setTourOpen] = useState(false);
  const [viewingPeriod, setViewingPeriod] = useState(() => {
    try {
      const saved = sessionStorage.getItem('hiusa_selected_academic_period');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [livePeriod, setLivePeriod] = useState(null);
  const [activeSubAccount, setActiveSubAccount] = useState(() => {
    try {
      const saved = sessionStorage.getItem('hiusa_active_subaccount');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleSubaccountChange = (e) => {
      setActiveSubAccount(e.detail || null);
    };
    window.addEventListener('hiusa-subaccount-switched', handleSubaccountChange);
    return () => window.removeEventListener('hiusa-subaccount-switched', handleSubaccountChange);
  }, []);

  useEffect(() => {
    if (typeof getActiveAcademicPeriod === 'function') {
      getActiveAcademicPeriod().then(setLivePeriod).catch(() => setLivePeriod(null));
    }
    function handleSwitched(e) {
      setViewingPeriod(e.detail);
    }
    window.addEventListener('hiusa-period-switched', handleSwitched);
    return () => window.removeEventListener('hiusa-period-switched', handleSwitched);
  }, []);

  function handleReturnToLive() {
    window.dispatchEvent(new CustomEvent('hiusa-reset-academic-period'));
    setViewingPeriod(livePeriod);
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
  if (pageMeta.matched && registeredHeaders === 0) {
    defaultHeader = contentHasHeading
      ? <div className="mb-4"><PageBreadcrumb crumbs={breadcrumbs} /></div>
      : <PageHeaderView className="mb-6" breadcrumbs={breadcrumbs} title={pageMeta.title} lead={pageMeta.isHome ? undefined : pageMeta.purpose} />;
  }

  return (
    <div className="flex h-[100dvh] max-w-full overflow-hidden bg-[#EEF6FB] font-sans text-[#0F172A]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} desktopCollapsed={desktopCollapsed} onToggleDesktop={toggleDesktopSidebar} />
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-[padding] duration-300 motion-reduce:transition-none ${desktopCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[260px]'}`}>
        <TopBar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        {activeSubAccount && (
          <aside aria-label="Sub-Account Oversight Banner" className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#0878B7]/30 bg-[#EEF6FB] px-4 py-2.5 text-xs text-[#0F2F62] shadow-xs backdrop-blur-sm sm:mx-6 sm:mt-3">
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0878B7] text-[10px] font-black text-white" aria-hidden="true">👥</span>
              <span>
                <strong>Sub-Account Oversight:</strong> Viewing <strong>{activeSubAccount.name} ({activeSubAccount.acronym})</strong> in Dean Supervisor mode.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem('hiusa_active_subaccount');
                window.dispatchEvent(new CustomEvent('hiusa-subaccount-switched', { detail: null }));
              }}
              className="rounded-lg border border-[#0878B7]/30 bg-white px-2.5 py-1 text-xs font-bold text-[#0878B7] shadow-xs transition hover:bg-brand-50 active:scale-[0.98]"
            >
              Return to Dean’s Office
            </button>
          </aside>
        )}
        {isPlanningMode && (
          <aside aria-label="Advance Planning Banner" className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-amber-300/80 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-950 shadow-xs backdrop-blur-sm sm:mx-6 sm:mt-3">
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-200 text-[10px] font-black text-amber-900" aria-hidden="true">!</span>
              <span>
                <strong>Advance Planning Mode:</strong> You are viewing <strong>AY {viewingPeriod.academic_year?.label} · {viewingPeriod.number === 1 ? '1st' : '2nd'} Semester</strong> ({viewingPeriod.status === 'upcoming' ? 'Upcoming' : 'Archive'}). Proposals and requirements will apply for this period.
              </span>
            </div>
            <button
              type="button"
              onClick={handleReturnToLive}
              className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-xs font-bold text-amber-900 shadow-xs transition hover:bg-amber-100 active:scale-[0.98]"
            >
              Return to Live Semester
            </button>
          </aside>
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6">
          <div className="route-fade-in">
            {defaultHeader}
            <PageHeaderRegistryContext value={registry}>
              <div ref={contentRef}>
                <Suspense fallback={<RouteLoadingFallback />}>
                  <Outlet />
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
