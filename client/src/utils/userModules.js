// An officer books venues only when their position allows it. A user stored before the flag existed keeps the page.
export function readCanBookVenues() {
  try {
    return JSON.parse(localStorage.getItem('user'))?.can_book_venues !== false;
  } catch {
    return true;
  }
}

// The org modules the active profile may open; null means all of them.
export function readUserModules() {
  try {
    const modules = JSON.parse(localStorage.getItem('user'))?.modules;
    return Array.isArray(modules) ? modules : null;
  } catch {
    return null;
  }
}
