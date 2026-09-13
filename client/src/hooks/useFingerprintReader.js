import { useEffect, useSyncExternalStore } from 'react';
import { digitalPersonaService } from '../services/digitalPersonaService';

export function useFingerprintReader() {
  const state = useSyncExternalStore(
    digitalPersonaService.subscribe,
    digitalPersonaService.getSnapshot,
    digitalPersonaService.getSnapshot,
  );

  useEffect(() => {
    digitalPersonaService.initialize();
    return () => { digitalPersonaService.cancelCapture(); };
  }, []);

  return {
    ...state,
    retry: () => digitalPersonaService.refreshReaders(),
    enrollFingerprint: (count, onProgress) => digitalPersonaService.enrollFingerprint(count, onProgress),
    identifyFingerprint: () => digitalPersonaService.identifyFingerprint(),
    cancelCapture: () => digitalPersonaService.cancelCapture(),
  };
}
