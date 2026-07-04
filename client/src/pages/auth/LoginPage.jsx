import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Hash } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { login } from '../../services/authService';

const ROLES = [
  { key: 'student', label: 'Student' },
  { key: 'officer', label: 'Officer' },
  { key: 'adviser', label: 'Adviser' },
  { key: 'admin', label: 'Admin' },
];

const ROLE_CONFIG = {
  student: { idField: 'school_id', label: 'Student ID', placeholder: 'e.g. 2023-00001', icon: Hash },
  officer: { idField: 'email', label: 'Email Address', placeholder: 'officer@university.edu', icon: Mail },
  adviser: { idField: 'email', label: 'Email Address', placeholder: 'adviser@university.edu', icon: Mail },
  admin:   { idField: 'email', label: 'Email Address', placeholder: 'admin@university.edu', icon: Mail },
};

const BrandingPanel = () => (
  <aside className="relative flex overflow-hidden bg-[#0b1831] px-6 py-5 text-white sm:min-h-[410px] sm:px-10 sm:py-8 lg:min-h-[620px] lg:w-[47%] lg:px-11 lg:py-10">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(25,211,249,0.20),transparent_34%),linear-gradient(135deg,#0b1831_0%,#0f2f62_52%,#075f93_100%)]" />
    <div className="absolute bottom-0 right-0 h-52 w-52 translate-x-14 translate-y-10 rotate-45 rounded-md border border-white/10 bg-white/[0.03]" />
    <div className="relative z-10 flex w-full flex-col">
      <div className="flex items-center gap-3">
        <img src={hiusaLogo} alt="HIUSA" className="h-10 w-10 object-contain sm:h-11 sm:w-11" />
        <span className="text-lg font-black text-white">HIUSA</span>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center">
        <div className="max-w-[360px]">
          <h1 className="text-2xl font-black leading-tight text-white sm:text-3xl lg:text-[34px]">
            The Simplest Way To Manage Your Organization
          </h1>
          <p className="mt-4 max-w-[320px] text-sm font-medium leading-6 text-slate-300">
            Payments, events, voting, tasks, and member records. All in one secure workspace.
          </p>
        </div>
      </div>
    </div>
  </aside>
);

export default function LoginPage() {
  const navigate = useNavigate();
  const [activeRole, setActiveRole] = useState('student');
  const [showPassword, setShowPassword] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const config = ROLE_CONFIG[activeRole];
  const IdIcon = config.icon;

  function handleRoleSwitch(role) {
    setActiveRole(role);
    setIdentifier('');
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const credentials = {
      [config.idField]: identifier.trim(),
      password,
      role: activeRole,
    };

    try {
      const response = await login(credentials);
      localStorage.setItem('auth_token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      const role = response.data.user?.role;
      const redirects = {
        admin: '/dashboard/admin',
        officer: '/dashboard/officer',
        adviser: '/dashboard/adviser',
        student: '/dashboard/student',
      };
      navigate(redirects[role] || '/dashboard');
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) {
        setError('Role mismatch: please select the correct role for this account.');
      } else if (status === 422) {
        const msgs = err.response?.data?.errors;
        const first = msgs ? Object.values(msgs).flat()[0] : null;
        setError(first || 'Invalid credentials.');
      } else {
        setError('Login failed. Check your credentials and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#eef6fb] px-4 py-5 font-sans text-slate-900 sm:px-6 sm:py-8">
      <section className="mx-auto flex w-full max-w-[960px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl shadow-[#0b1831]/10 ring-1 ring-slate-200/70 lg:min-h-[620px] lg:flex-row">
        <BrandingPanel />

        <div className="relative flex flex-1 items-center bg-white px-6 py-7 sm:px-10 sm:py-12 lg:px-14">
          <div className="mx-auto w-full max-w-[370px]">
            <div className="mb-6">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#0b8ed0]">Secure login</p>
              <h2 className="text-2xl font-black text-slate-950 sm:text-[28px]">Welcome back!</h2>
              <p className="mt-1.5 text-sm font-medium text-slate-500">Sign in to access your account.</p>
            </div>

            {/* Role Tabs */}
            <div className="mb-6 flex rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-1 gap-0.5">
              {ROLES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => handleRoleSwitch(r.key)}
                  className={`flex-1 rounded-md py-2 text-[12px] font-bold transition ${
                    activeRole === r.key
                      ? 'bg-[#0B8ED0] text-white shadow-sm'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {/* Identifier field */}
              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-slate-800">{config.label}</label>
                <div className="group relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 transition-colors group-focus-within:text-[#0b8ed0]">
                    <IdIcon size={17} />
                  </div>
                  <input
                    type={activeRole === 'student' ? 'text' : 'email'}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={config.placeholder}
                    required
                    className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-4 text-sm font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0b8ed0] focus:ring-4 focus:ring-[#16c7f3]/15"
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-slate-800">Password</label>
                <div className="group relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 transition-colors group-focus-within:text-[#0b8ed0]">
                    <Lock size={17} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-11 text-sm font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0b8ed0] focus:ring-4 focus:ring-[#16c7f3]/15"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition hover:text-[#0b8ed0]"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <button type="button" className="font-bold text-[#0878b7] transition hover:text-[#0b1831]">
                  Forgot Password?
                </button>
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0b8ed0] px-4 text-sm font-bold text-white shadow-lg shadow-[#0b8ed0]/25 transition hover:bg-[#0878b7] active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? 'Signing in…' : `Sign in as ${ROLES.find((r) => r.key === activeRole)?.label}`}
                  {!loading && <ArrowRight size={17} />}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
