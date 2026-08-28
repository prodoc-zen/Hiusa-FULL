import { Cpu, Server } from 'lucide-react';

const ENGINE_LABELS = {
  'python-fastapi': 'Python AI service',
  'php-fallback': 'Local fallback engine',
};

export default function EngineBadge({ engine, className = '' }) {
  const isPython = engine === 'python-fastapi';
  const label = engine ? (ENGINE_LABELS[engine] || engine) : 'Engine not reported';
  const tone = engine ? (isPython ? 'bg-[#E6F6FD] text-[#0878B7]' : 'bg-slate-100 text-slate-600') : 'bg-slate-100 text-slate-400';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tone} ${className}`}>
      {isPython ? <Server size={12} /> : <Cpu size={12} />}
      {label}
    </span>
  );
}
