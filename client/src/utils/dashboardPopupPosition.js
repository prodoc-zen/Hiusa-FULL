export function dashboardPopupTop() {
  const navbarBottom = Number.parseFloat(document.documentElement.style.getPropertyValue('--dashboard-navbar-bottom'));
  return Number.isFinite(navbarBottom) ? Math.max(12, navbarBottom + 8) : 12;
}

export function dashboardPopupLeft() {
  if (window.innerWidth < 1024) return 12;
  const sidebarWidth = Number.parseFloat(document.documentElement.style.getPropertyValue('--dashboard-sidebar-width'));
  return Number.isFinite(sidebarWidth) ? Math.max(12, sidebarWidth + 12) : 12;
}
