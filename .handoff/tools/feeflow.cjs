const api = 'http://127.0.0.1:8000/api';
async function login(school_id, password) {
  const r = await fetch(api + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ school_id, password }) });
  return (await r.json()).access_token;
}
async function call(token, method, path, body) {
  const r = await fetch(api + path, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}
(async () => {
  const admin = await login(900001, 'Demo@12345');
  const gen = await call(admin, 'POST', '/financial-reports/generate', { report_type: 'custom', period_start: '2026-06-01', period_end: '2026-11-13', signatories: { treasurer: 'Treasurer Name', president: 'President Name', adviser: 'Adviser Name', sbo_adviser: 'SBO Adviser Name' } });
  console.log('generate', gen.status, JSON.stringify(gen.body).slice(0, 300));
  const id = gen.body?.report?.id ?? gen.body?.data?.id ?? gen.body?.id;
  if (!id) return;
  const sub = await call(admin, 'POST', `/financial-reports/${id}/submit`, {});
  console.log('submit', sub.status, JSON.stringify(sub.body).slice(0, 300));
  const head = await login(940001, 'Demo@12345');
  let q = await call(head, 'GET', '/approval-requests?status=pending');
  const rows = q.body?.data ?? q.body ?? [];
  const req = (Array.isArray(rows) ? rows : rows.data || []).find((x) => x.entity_type === 'financial_report' && Number(x.entity_id) === Number(id));
  console.log('head sees', req?.id, req?.status);
  if (!req) return;
  const a1 = await call(head, 'PATCH', `/approval-requests/${req.id}`, { status: 'approved', remarks: 'Checked against the ledger.' });
  console.log('head review', a1.status, JSON.stringify(a1.body).slice(0, 200));
  const sao = await login(990001, 'Admin@123456');
  q = await call(sao, 'GET', '/approval-requests?status=pending');
  const rows2 = q.body?.data ?? q.body ?? [];
  const req2 = (Array.isArray(rows2) ? rows2 : rows2.data || []).find((x) => x.entity_type === 'financial_report' && Number(x.entity_id) === Number(id));
  console.log('sao sees', req2?.id, req2?.status);
  if (!req2) return;
  const a2 = await call(sao, 'PATCH', `/approval-requests/${req2.id}`, { status: 'approved', remarks: 'Approved.' });
  console.log('sao review', a2.status, JSON.stringify(a2.body).slice(0, 200));
  const student = await login(2100142, 'Demo@12345');
  const fee = await call(student, 'GET', '/student/fee-usage');
  console.log('fee-usage', fee.status, JSON.stringify(fee.body).slice(0, 900));
})();
