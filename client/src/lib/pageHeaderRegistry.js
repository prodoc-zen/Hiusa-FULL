import { createContext, useContext, useLayoutEffect } from 'react';

// DashboardLayout provides this so it can tell whether the routed page renders its own PageHeader.
// A page that does not gets the layout's default header, so every page has exactly one h1.
export const PageHeaderRegistryContext = createContext(null);

export function useRegisterPageHeader() {
  const registry = useContext(PageHeaderRegistryContext);
  useLayoutEffect(() => registry?.register(), [registry]);
}
