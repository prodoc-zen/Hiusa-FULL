import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCircle2, Mail, Send, X } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { requestPasswordReset } from '../../services/authService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function RecoverAccountPage() {
  const navigate = useNavigate();
  const [selectedOrganization, setSelectedOrganization] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('selected_organization');

    if (!stored) {
      navigate('/select-organization', { replace: true });
      return;
    }

    try {
      setSelectedOrganization(JSON.parse(stored));
    } catch {
      localStorage.removeItem('selected_organization');
      navigate('/select-organization', { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNoticeOpen(false);
    setLoading(true);

    try {
      await requestPasswordReset({
        organization_id: selectedOrganization?.id,
        email: email.trim(),
      });

      setSubmittedEmail(email.trim());
      setNoticeOpen(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to send reset instructions.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#eef6fb] px-4 py-6 font-sans text-slate-900">
      <section className="w-full max-w-[440px] rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-xl shadow-[#0B1831]/10 sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <img src={hiusaLogo} alt="HIUSA" className="h-10 w-10 object-contain" />
          <div>
            <p className="text-lg font-black text-[#0B1831]">HIUSA</p>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0B8ED0]">Recover account</p>
          </div>
        </div>

        {selectedOrganization && (
          <div className="mb-5 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#E9F7FD] text-[#0B8ED0]">
                <Building2 size={17} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-slate-500">Selected organization</p>
                <p className="truncate text-sm font-bold text-slate-900">{selectedOrganization.name}</p>
              </div>
            </div>
          </div>
        )}

        <h1 className="text-2xl font-black text-slate-950">Reset your password</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
          Enter the email address linked to your account. We will send a reset link you can use to create a new password.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-semibold text-slate-800">Email address</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@university.edu"
                required
                className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-4 text-sm font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
              />
            </span>
          </label>

          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={loading || !selectedOrganization}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0B8ED0] px-4 text-sm font-bold text-white shadow-lg shadow-[#0B8ED0]/20 transition hover:bg-[#0878B7] active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? 'Sending...' : 'Send reset link'}
            {!loading && <Send size={17} />}
          </button>
        </form>

        <Link to="/login" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#0878B7] hover:text-[#0B1831]">
          <ArrowLeft size={15} />
          Back to login
        </Link>
      </section>

      {noticeOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#0B1831]/55 px-4 backdrop-blur-sm">
          <section className="w-full max-w-[390px] rounded-lg border border-emerald-100 bg-white p-6 shadow-2xl shadow-[#0B1831]/20">
            <div className="flex items-start justify-between gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={22} />
              </div>
              <button
                type="button"
                aria-label="Close confirmation"
                onClick={() => setNoticeOpen(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={17} />
              </button>
            </div>
            <h2 className="mt-4 text-xl font-black text-slate-950">Check your email</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
              We sent password reset instructions to <span className="font-bold text-slate-700">{submittedEmail}</span>.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="h-10 rounded-md bg-[#0B8ED0] px-4 text-sm font-bold text-white transition hover:bg-[#0878B7]"
              >
                Back to login
              </button>
              <button
                type="button"
                onClick={() => setNoticeOpen(false)}
                className="h-10 rounded-md border border-[#DDE7EF] px-4 text-sm font-bold text-slate-600 transition hover:bg-[#F8FBFD]"
              >
                Stay here
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
