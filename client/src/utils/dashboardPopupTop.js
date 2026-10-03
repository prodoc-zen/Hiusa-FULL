export function dashboardPopupTop() {
  const navbarBottom = Number.parseFloat(document.documentElement.style.getPropertyValue('--dashboard-navbar-bottom'));
  return Number.isFinite(navbarBottom) ? Math.max(12, navbarBottom + 8) : 12;
}
