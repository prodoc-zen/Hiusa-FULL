import { useEffect, useRef } from 'react';
import notify from '../lib/notify';

export default function FeedbackToast({ feedback, onClose, duration = 3600 }) {
  const shownKeyRef = useRef(null);

  useEffect(() => {
    const isOpen = Boolean(feedback?.open && feedback?.message);

    if (!isOpen) {
      shownKeyRef.current = null;
      return;
    }

    const key = `${feedback.type || 'info'}:${feedback.message}`;
    if (shownKeyRef.current === key) {
      return;
    }
    shownKeyRef.current = key;

    const options = { duration, onDismiss: onClose, onAutoClose: onClose };

    if (feedback.type === 'success') {
      notify.success(feedback.message, options);
    } else if (feedback.type === 'error') {
      notify.error(feedback.message, options);
    } else {
      notify.info(feedback.message, options);
    }
  }, [feedback, duration, onClose]);

  return null;
}
