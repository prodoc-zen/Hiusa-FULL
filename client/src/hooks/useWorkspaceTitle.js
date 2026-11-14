import { useEffect } from 'react';
import { storedUser } from '../utils/collegeIdentity';
import { workspaceTitle } from '../utils/workspaceLabels';

// Names the workspace in the browser tab, so two tabs on two profiles can be told apart.
export default function useWorkspaceTitle() {
  useEffect(() => {
    const previous = document.title;
    document.title = workspaceTitle(storedUser());
    return () => {
      document.title = previous;
    };
  }, []);
}
