// The org modules the active profile may open; null means all of them.
export function readUserModules() {
  try {
    const modules = JSON.parse(localStorage.getItem('user'))?.modules;
    return Array.isArray(modules) ? modules : null;
  } catch {
    return null;
  }
}
