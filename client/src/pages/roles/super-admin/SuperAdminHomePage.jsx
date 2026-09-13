import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ClipboardCheck, Coins, Megaphone, ShieldCheck, Users } from 'lucide-react';
import { getApprovalRequests } from '../../../services/approvalService';
import { getAnnouncements } from '../../../services/announcementService';
import { getUsers } from '../../../services/userService';
import { getFinancialDashboard } from '../../../services/financeService';
import { listMeta } from '../../../services/pagination';

export default function SuperAdminHomePage() {
  const [metrics, setMetrics] = useState({ users: 0, admins: 0, approvals: 0, announcements: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      getUsers({ per_page: 1 }),
      getApprovalRequests({ status: 'pending', per_page: 1 }),
      getAnnouncements({ publication_status: 'published', per_page: 1 }),
      getFinancialDashboard(),
    ]).then(([users, approvals, announcements, financial]) => {
      if (!active) return;
      setMetrics({
        users: Number(users?.total || 0),
        admins: Number(users?.summary?.by_role?.ADMIN || 0),
        approvals: listMeta(approvals.data).total + Number(financial.data?.pending_financial_approvals || 0),
        announcements: listMeta(announcements.data).total,
      });
    }).catch(() => {}).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const cards = [
    { label: 'Organization Users', value: metrics.users, icon: Users, tone: 'bg-[#E6F6FD] text-[#0B8ED0]' },
    { label: 'Administrator Accounts', value: metrics.admins, icon: ShieldCheck, tone: 'bg-violet-50 text-violet-700' },
    { label: 'Financial Approvals', value: metrics.approvals, icon: ClipboardCheck, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Published Announcements', value: metrics.announcements, icon: Megaphone, tone: 'bg-emerald-50 text-emerald-700' },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#0B1831] text-[#16C7F3]"><ShieldCheck size={24} /></span>
          <div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Super Admin Portal</p><h2 className="mt-1 text-2xl font-black text-[#0F172A] sm:text-3xl">Organization Oversight</h2><p className="mt-1 text-sm font-medium text-slate-500">Control administrator access, publish organization-wide notices, and provide final financial sign-off.</p></div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <article key={card.label} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><span className={`grid h-10 w-10 place-items-center rounded-lg ${card.tone}`}><card.icon size={19} /></span><p className="mt-4 text-sm font-semibold text-slate-500">{card.label}</p>{loading ? <div className="mt-2 h-7 w-12 animate-pulse rounded bg-slate-100" /> : <p className="mt-1 text-2xl font-black tabular-nums text-[#0F172A]">{card.value}</p>}</article>)}
      </section>

      {metrics.approvals > 0 && <NavLink to="/dashboard/super-admin/approvals" className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5 transition hover:bg-amber-100"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-amber-700"><Coins size={19} /></span><div><p className="font-bold text-[#0F172A]">{metrics.approvals} financial request{metrics.approvals === 1 ? '' : 's'} awaiting final approval</p><p className="text-xs font-medium text-amber-800">Review the record details before funds are made available.</p></div></div><span className="text-sm font-bold text-amber-800">Review now</span></NavLink>}

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><h3 className="text-base font-bold text-[#0F172A]">Super Admin Actions</h3><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Create & manage admins', '/dashboard/admin/users'],
        ['Review financial approvals', '/dashboard/super-admin/approvals'],
        ['Create announcement', '/dashboard/announcements/create-announcement'],
        ['Financial oversight', '/dashboard/finance/financial-ledger'],
      ].map(([label, path]) => <NavLink key={path} to={path} className="flex min-h-11 items-center rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-sm font-semibold text-[#0F172A] hover:border-[#0B8ED0]/40 hover:bg-white">{label}</NavLink>)}</div></section>
    </div>
  );
}
