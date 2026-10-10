import { useEffect, useState } from 'react';
import { getEventSubmission } from '../../services/eventService';

// How many of the SAO's listed files the organization has uploaded for an event, for the NextStep
// body. EventSubmissionPanel loads the same endpoint for its own checklist and keeps that data to
// itself, so the count is read here and reloaded when `version` changes after an upload.
export default function useRequirementProgress(eventId, enabled, version = 0) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!enabled || !eventId) {
      setProgress(null);
      return undefined;
    }
    let active = true;
    (async () => {
      try {
        const response = await getEventSubmission(eventId);
        if (!active) return;
        const requirements = response.data?.requirements ?? [];
        const uploaded = new Set((response.data?.files ?? []).map((file) => file.requirement_id ?? file.requirement?.id));
        setProgress({ total: requirements.length, done: requirements.filter((requirement) => uploaded.has(requirement.id)).length });
      } catch {
        if (active) setProgress(null);
      }
    })();
    return () => { active = false; };
  }, [eventId, enabled, version]);

  return progress;
}
