import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// Reads the route tree straight out of client/src/App.jsx, the same way the server's
// ClientRouteAllowlistTest does: it walks the <Route> lines, resolves each path under its parents and
// carries the allowedRoles of the ProtectedRoute guarding it. App.jsx does not export its paths, so
// the text is the only source. `roles` is null where no guard restricts the role.
const APP_SOURCE = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8');

function intersect(parent, own) {
  if (own === null) return parent;
  if (parent === null) return own;
  return own.filter((role) => parent.includes(role));
}

function resolvePath(stack, segment) {
  let path = '';
  [...stack, segment].forEach((part) => {
    if (part === null) return;
    path = part.startsWith('/') ? part : `${path}/${part}`;
  });
  return path;
}

export function parseAppRoutes(source = APP_SOURCE) {
  const stack = [];
  const roleStack = [];
  const routes = [];

  source.split('\n').forEach((line) => {
    const trimmed = line.trim();

    if (trimmed === '</Route>') {
      stack.pop();
      roleStack.pop();
      return;
    }
    if (!trimmed.includes('<Route')) return;

    const selfClosed = /\/>\s*\}?\s*$/.test(trimmed);
    const path = trimmed.match(/\bpath="([^"]*)"/)?.[1] ?? null;
    const rolesText = trimmed.match(/allowedRoles=\{\[([^\]]*)\]\}/)?.[1];
    const own = rolesText === undefined ? null : [...rolesText.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
    const parentRoles = roleStack.length > 0 ? roleStack[roleStack.length - 1] : null;
    const roles = intersect(parentRoles, own);

    if (path !== null) {
      routes.push({ path: resolvePath(stack, path), roles, redirect: trimmed.includes('<Navigate') });
    }
    if (!selfClosed) {
      stack.push(path);
      roleStack.push(roles);
    }
  });

  return routes;
}

export function dashboardRoutes() {
  return parseAppRoutes().filter((route) => route.path.startsWith('/dashboard'));
}

export function roleCanOpen(route, role) {
  return route.roles === null || route.roles.includes(role);
}
