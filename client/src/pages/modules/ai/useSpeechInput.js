import { useCallback, useEffect, useRef, useState } from 'react';

const PRIMARY_LANG = 'en-PH';
const FALLBACK_LANG = 'en-US';

export const SPEECH_MESSAGES = {
  blocked: 'The microphone is blocked. Allow it in your browser settings, or type your question.',
  silent: 'Did not hear anything. Tap the mic and try again.',
  failed: 'Voice typing stopped. Type your question instead.',
};

const recognitionClass = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

// Browser speech to text. The text goes to `onText` for the person to edit and send; nothing here sends it.
// `supported` is false where the browser has no recognition, and the caller then shows no mic at all.
export default function useSpeechInput({ onText, getBase, limit }) {
  const [supported] = useState(() => Boolean(recognitionClass()));
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState('');
  const recRef = useRef(null);
  const beginRef = useRef(null);
  const handlers = useRef({ onText, getBase, limit });

  useEffect(() => {
    handlers.current = { onText, getBase, limit };
  });

  const release = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try { rec.abort(); } catch { /* already stopped */ }
  }, []);

  useEffect(() => release, [release]);

  const begin = useCallback((lang, base) => {
    const Recognition = recognitionClass();
    if (!Recognition) return;
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    // One utterance at a time: the browser ends the session itself once the person goes quiet.
    rec.continuous = false;
    recRef.current = rec;

    rec.onresult = (event) => {
      if (recRef.current !== rec) return;
      const heard = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join('').trim();
      const { onText: put, limit: max } = handlers.current;
      put(`${base}${heard}`.slice(0, max));
    };
    rec.onerror = (event) => {
      if (recRef.current !== rec) return;
      const code = event.error;
      if (code === 'language-not-supported' && lang !== FALLBACK_LANG) {
        beginRef.current(FALLBACK_LANG, base);
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') setProblem(SPEECH_MESSAGES.blocked);
      else if (code === 'no-speech') setProblem(SPEECH_MESSAGES.silent);
      else if (code !== 'aborted') setProblem(SPEECH_MESSAGES.failed);
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      setListening(false);
    };

    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
      setProblem(SPEECH_MESSAGES.failed);
    }
  }, []);

  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const start = useCallback(() => {
    if (recRef.current) return;
    setProblem('');
    const current = handlers.current.getBase();
    begin(PRIMARY_LANG, current && !/\s$/.test(current) ? `${current} ` : current);
  }, [begin]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try { rec.stop(); } catch { release(); setListening(false); }
  }, [release]);

  const toggle = useCallback(() => (recRef.current ? stop() : start()), [start, stop]);

  return { supported, listening, problem, clearProblem: () => setProblem(''), toggle, stop };
}
