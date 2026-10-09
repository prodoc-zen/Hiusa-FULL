import { Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import RouteLoadingFallback from './RouteLoadingFallback';
import { PageBreadcrumb, PageHeaderView } from '../ui/PageHeader';
import { PageHeaderRegistryContext } from '../../lib/pageHeaderRegistry';
import { getBreadcrumbs, getPageMeta, getStoredRole } from '../../lib/pageMeta';

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
    </div>
  );
}
