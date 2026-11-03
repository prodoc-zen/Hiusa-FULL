import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ShieldCheck, AlertCircle, Building2 } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { Button, Card, Field, Input } from '../../components/ui';
import { getDepartmentHeadInvitation, acceptDepartmentHeadInvitation } from '../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText.js';

export default function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteData, setInviteData] = useState(null);

  const [schoolId, setSchoolId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('No invitation token was provided in the link. Please check your invitation URL.');
      setLoading(false);
      return;
    }

    getDepartmentHeadInvitation(token)
      .then((data) => {
        setInviteData(data);
        if (data?.invitation?.school_id) {
          setSchoolId(String(data.invitation.school_id));
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(getApiErrorMessage(err, 'This invitation link is invalid or has expired. Please contact the Student Affairs Office for a new invite.'));
        setLoading(false);
      });
  }, [token]);

  async function handleAccept(e) {
    e.preventDefault();
    const errs = {};
    if (!schoolId.trim()) {
      errs.school_id = 'School ID is required.';
    } else if (!/^\d{1,8}$/.test(schoolId.trim()) || Number(schoolId) < 1) {
      errs.school_id = 'Enter a valid School ID (up to 8 digits).';
    }

    if (!password) {
      errs.password = 'Create a secure password.';
    } else if (password.length < 8) {
      errs.password = 'Password must be at least 8 characters.';
    }

    if (!passwordConfirmation) {
      errs.password_confirmation = 'Confirm your password.';
    } else if (password !== passwordConfirmation) {
      errs.password_confirmation = 'Passwords do not match.';
    }

    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const res = await acceptDepartmentHeadInvitation(token, {
        school_id: Number(schoolId),
        password,
        password_confirmation: passwordConfirmation,
      });

      if (res?.token) {
        localStorage.setItem('auth_token', res.token);
      }
      if (res?.user) {
        localStorage.setItem('user', JSON.stringify(res.user));
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/dashboard/department-head');
      }, 1500);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not complete your registration. Please try again.'));
      setSubmitting(false);
    }
  }

  const collegeName = inviteData?.college?.name ? formatDisplayText(inviteData.college.name) : 'Your College';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EEF6FB] px-4 py-12">
      <div className="w-full max-w-md">
        {/* Clean University Header */}
        <div className="mb-6 text-center">
          <img src={hiusaLogo} alt="HIUSA Logo" className="mx-auto h-12 w-12 object-contain" />
          <h1 className="mt-3 text-xl font-black tracking-tight text-[#0B1831]">HIUSA Academic Governance</h1>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-[#0878B7]">University of Cebu</p>
        </div>

        <Card className="rounded-2xl border border-[#DDE7EF] bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
          {loading && (
            <div className="space-y-4 py-8 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0878B7] border-t-transparent" />
              <p className="text-sm font-semibold text-slate-600">Verifying invitation credentials…</p>
            </div>
          )}

          {!loading && error && (
            <div className="space-y-4 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-100 text-red-600">
                <AlertCircle size={24} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#0F172A]">Invitation Unavailable</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{error}</p>
              </div>
              <div className="pt-2">
                <Link
                  to="/"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-[#0878B7] px-5 text-xs font-bold text-white transition hover:bg-[#0B1831]"
                >
                  Return to Home
                </Link>
              </div>
            </div>
          )}

          {!loading && !error && success && (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 size={32} />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-[#0F172A]">Welcome, Department Head!</h2>
                <p className="mt-1 text-xs text-slate-600">Your account is ready. Entering your College Workspace…</p>
              </div>
            </div>
          )}

          {!loading && !error && !success && inviteData && (
            <div>
              <div className="mb-6 border-b border-[#DDE7EF] pb-5">
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-[#0878B7]">
                  <Building2 size={12} />
                  <span>Official Appointment</span>
                </div>
                <h2 className="text-xl font-extrabold text-[#0F172A]">
                  Welcome, {inviteData.invitation?.first_name} {inviteData.invitation?.last_name}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  You have been invited by the Student Affairs Office to serve as <strong>Department Head</strong> for <strong>{collegeName}</strong>.
                </p>
              </div>

              <form onSubmit={handleAccept} className="space-y-4">
                <Field label="School ID" required error={formErrors.school_id} hint={inviteData.invitation?.school_id ? 'Assigned by SAO' : 'Your 8-digit university ID number'}>
                  <Input
                    type="text"
                    inputMode="numeric"
                    disabled={Boolean(inviteData.invitation?.school_id)}
                    value={schoolId}
                    onChange={(e) => setSchoolId(e.target.value)}
                    placeholder="e.g. 20261001"
                  />
                </Field>

                <Field label="Email address">
                  <Input
                    type="email"
                    disabled
                    value={inviteData.invitation?.email || ''}
                    className="bg-slate-50 text-slate-600"
                  />
                </Field>

                <Field label="Create password" required error={formErrors.password} hint="At least 8 characters">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create your secure password"
                  />
                </Field>

                <Field label="Confirm password" required error={formErrors.password_confirmation}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={passwordConfirmation}
                    onChange={(e) => setPasswordConfirmation(e.target.value)}
                    placeholder="Re-enter your password"
                  />
                </Field>

                <div className="pt-2">
                  <Button
                    type="submit"
                    loading={submitting}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0878B7] text-sm font-bold text-white shadow-md transition hover:bg-[#0B1831] active:scale-[0.98]"
                  >
                    <span>Activate &amp; Enter Workspace</span>
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </form>

              <div className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-600">
                <ShieldCheck size={13} className="text-[#0878B7]" />
                <span>Protected by HIUSA Institutional Security</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

