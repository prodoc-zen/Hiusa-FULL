import { Cpu, Server } from 'lucide-react';

const ENGINE_LABELS = {
  'python-fastapi': 'Python AI service',
  'ai-service': 'Python AI service',
  'php-fallback': 'Local fallback engine',
};

export default function EngineBadge({ engine, className = '' }) {
  // No engine means nothing useful to say, so show no chip rather than internal jargon.
  if (!engine) return null;

  const isPython = engine === 'python-fastapi' || engine === 'ai-service';
  const label = ENGINE_LABELS[engine] || engine;
  const tone = isPython ? 'bg-brand-50 text-navy-800' : 'bg-slate-100 text-slate-700';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${tone} ${className}`}>
      {isPython ? <Server size={12} /> : <Cpu size={12} />}
      {label}
    </span>
  );
}
