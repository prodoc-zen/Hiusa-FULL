import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { resetPassword, validatePasswordResetToken } from '../../services/authService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const resetPayload = useMemo(() => ({
    organization_id: searchParams.get('organization_id') || '',
    email: searchParams.get('email') || '',
    token: searchParams.get('token') || '',
  }), [searchParams]);

  useEffect(() => {
    let alive = true;

    async function validateToken() {
      setCheckingToken(true);
      setError('');

      try {
        await validatePasswordResetToken(resetPayload);
        if (alive) {
          setTokenValid(true);
        }
      } catch (err) {
        if (alive) {
          setTokenValid(false);
          setError(err.response?.data?.message || 'Password reset token is invalid or expired.');
        }
      } finally {
        if (alive) {
          setCheckingToken(false);
        }
      }
    }

    if (!resetPayload.organization_id || !resetPayload.email || !resetPayload.token) {
      setCheckingToken(false);
      setError('Password reset link is missing required information.');
      return;
    }

    validateToken();

    return () => {
      alive = false;
    };
  }, [resetPayload]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const response = await resetPassword({
        ...resetPayload,
        password,
        password_confirmation: passwordConfirmation,
      });

      setSuccess(response.data?.message || 'Password updated successfully.');
      window.setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to update password.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#eef6fb] px-4 py-6 font-sans text-slate-900">
      <section className="w-full max-w-[440px] rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-xl shadow-[#0B1831]/10 sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <img src={hiusaLogo} alt="HIUSA" className="h-10 w-10 object-contain" />
          <div>
            <p className="text-lg font-black text-[#0B1831]">HIUSA</p>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0B8ED0]">New password</p>
          </div>
        </div>

        <h1 className="text-2xl font-black text-slate-950">Create a new password</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
          Use at least 8 characters. After the update, any existing sessions for this account are signed out.
        </p>

        {checkingToken && (
          <div className="mt-6 rounded-md border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2.5 text-xs font-semibold text-slate-600">
            Validating reset link...
          </div>
        )}

        {!checkingToken && error && (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600">{error}</div>
        )}

        {!checkingToken && success && (
          <div className="mt-6 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={15} />
            {success}
          </div>
        )}

        {tokenValid && (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-1.5">
              <span className="block text-[13px] font-semibold text-slate-800">New password</span>
              <span className="relative block">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter new password"
                  required
                  minLength={8}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-11 text-sm font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition hover:text-[#0B8ED0]"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>

            <label className="block space-y-1.5">
              <span className="block text-[13px] font-semibold text-slate-800">Confirm new password</span>
              <span className="relative block">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  placeholder="Confirm new password"
                  required
                  minLength={8}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-4 text-sm font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </span>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="flex h-11 w-full items-center justify-center rounded-md bg-[#0B8ED0] px-4 text-sm font-bold text-white shadow-lg shadow-[#0B8ED0]/20 transition hover:bg-[#0878B7] active:scale-[0.99] disabled:opacity-60"
            >
              {saving ? 'Updating...' : 'Update password'}
            </button>
          </form>
        )}

        <Link to="/login" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#0878B7] hover:text-[#0B1831]">
          <ArrowLeft size={15} />
          Back to login
        </Link>
      </section>
    </main>
  );
}
