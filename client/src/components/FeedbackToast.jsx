import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const typeConfig = {
  success: {
    icon: CheckCircle2,
    box: 'border-emerald-200 bg-emerald-50',
    iconClass: 'text-emerald-600',
    text: 'text-emerald-800',
    button: 'text-emerald-700 hover:text-emerald-900',
  },
  error: {
    icon: AlertCircle,
    box: 'border-red-200 bg-red-50',
    iconClass: 'text-red-600',
    text: 'text-red-700',
    button: 'text-red-600 hover:text-red-800',
  },
  info: {
    icon: Info,
    box: 'border-sky-200 bg-sky-50',
    iconClass: 'text-sky-600',
    text: 'text-sky-800',
    button: 'text-sky-700 hover:text-sky-900',
  },
};

export default function FeedbackToast({ feedback, onClose, duration = 3600 }) {
  const isOpen = Boolean(feedback?.open && feedback?.message);
  const config = typeConfig[feedback?.type] || typeConfig.info;
  const Icon = config.icon;

  useEffect(() => {
    if (!isOpen || !duration) return undefined;

    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [duration, isOpen, onClose, feedback?.message]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed right-4 top-4 z-[70] w-[calc(100%-2rem)] max-w-sm">
      <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-xl shadow-slate-900/10 ${config.box}`}>
        <Icon size={18} className={`mt-0.5 shrink-0 ${config.iconClass}`} />
        <p className={`min-w-0 flex-1 text-sm font-semibold leading-5 ${config.text}`}>{feedback.message}</p>
        <button type="button" aria-label="Close notification" onClick={onClose} className={`shrink-0 ${config.button}`}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
