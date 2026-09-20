function formatMoney(value) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FinancialForecastChart({ forecasts, className = 'mt-5' }) {
  const points = forecasts.map((forecast) => ({
    label: String(forecast.forecast_period || '').slice(0, 7),
    income: Number(forecast.predicted_income || 0),
    expense: Number(forecast.predicted_expense || 0),
    balance: Number(forecast.predicted_balance || 0),
  }));
  if (!points.length) return null;

  const width = 760;
  const height = 280;
  const pad = { top: 18, right: 20, bottom: 42, left: 70 };
  const values = points.flatMap((point) => [point.income, point.expense, point.balance]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;
  const x = (index) => pad.left + (points.length === 1 ? (width - pad.left - pad.right) / 2 : index * (width - pad.left - pad.right) / (points.length - 1));
  const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / range;
  const path = (key) => points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point[key])}`).join(' ');
  const series = [
    { key: 'income', label: 'Predicted income', color: '#16A34A' },
    { key: 'expense', label: 'Predicted expenses', color: '#DC2626' },
    { key: 'balance', label: 'Projected balance', color: '#0B8ED0' },
  ];

  return (
    <div className={className} aria-label="Forecast line graph">
      <div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-600">{series.map((item) => <span key={item.key} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />{item.label}</span>)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Line graph comparing predicted income, expenses, and balance by forecast period">
        <title>Financial forecast line graph</title>
        {[0, .25, .5, .75, 1].map((step) => { const value = max - range * step; const lineY = y(value); return <g key={step}><line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke="#DDE7EF" /><text x={pad.left - 8} y={lineY + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{formatMoney(value)}</text></g>; })}
        {series.map((item) => <path key={item.key} d={path(item.key)} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
        {points.map((point, index) => <g key={point.label || index}>{series.map((item) => <circle key={item.key} cx={x(index)} cy={y(point[item.key])} r="4" fill={item.color}><title>{`${point.label}: ${item.label} ${formatMoney(point[item.key])}`}</title></circle>)}<text x={x(index)} y={height - 16} textAnchor="middle" className="fill-slate-500 text-[10px]">{point.label}</text></g>)}
      </svg>
      <div className="sr-only"><table><caption>Financial forecast data</caption><thead><tr><th>Period</th><th>Income</th><th>Expenses</th><th>Balance</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><td>{point.label}</td><td>{formatMoney(point.income)}</td><td>{formatMoney(point.expense)}</td><td>{formatMoney(point.balance)}</td></tr>)}</tbody></table></div>
    </div>
  );
}
