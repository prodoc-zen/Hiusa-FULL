import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { login } from '../../services/authService';
import { useNavigate } from 'react-router-dom';


// Reusable field wrapper for the login form inputs.
const InputField = ({ label, name, type, placeholder, icon: Icon, isPassword }) => {
  const [showPassword, setShowPassword] = useState(false);
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="space-y-2">
      <label className="block text-[13px] font-semibold text-slate-800">
        {label}
      </label>
      <div className="group relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 transition-colors group-focus-within:text-[#0f9ed5]">
          <Icon size={17} />
        </div>

        <input
          name={name}
          type={inputType}
          placeholder={placeholder}
          className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-11 text-sm font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#0f9ed5] focus:ring-4 focus:ring-[#16c7f3]/15"
        />

        {isPassword && (
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition hover:text-[#0f9ed5]"
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
    </div>
  );
};

// Primary form action button.
const PrimaryButton = ({ children }) => (
  <button
    type="submit"
    className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0b8ed0] px-4 text-sm font-bold text-white shadow-lg shadow-[#0b8ed0]/25 transition hover:bg-[#0878b7] active:scale-[0.99]"
  >
    {children}
    <ArrowRight size={17} />
  </button>
);



// Compact brand mark used by the login and future auth screens.
const LogoMark = () => (
  <div className="flex items-center gap-3">
    <div className="h-11 w-11">
      <img
        src={hiusaLogo}
        alt="HIUSA logo"
        className="h-full w-full object-contain"
      />
    </div>

    <span className="text-lg font-black text-white">
      HIUSA
    </span>
  </div>
);

// Left-side brand panel; keep this separate when splitting the page into components.
const BrandingPanel = () => (
  <aside className="relative flex min-h-[360px] overflow-hidden bg-[#0b1831] px-6 py-6 text-white sm:min-h-[410px] sm:px-10 sm:py-8 lg:min-h-[620px] lg:w-[47%] lg:px-11 lg:py-10">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(25,211,249,0.20),transparent_34%),linear-gradient(135deg,#0b1831_0%,#0f2f62_52%,#075f93_100%)]" />
    <div className="absolute bottom-0 right-0 h-52 w-52 translate-x-14 translate-y-10 rounded-md border border-white/10 bg-white/[0.03] rotate-45" />

    <div className="relative z-10 flex w-full flex-col">
      <LogoMark />

      <div className="flex flex-1 items-center">
        <div className="max-w-[360px]">
          <h1 className="text-2xl font-black leading-tight text-white sm:text-3xl lg:text-[34px]">
            The Simplest Way To Manage Your Business
          </h1>
          <p className="mt-4 max-w-[320px] text-sm font-medium leading-6 text-slate-200">
            Keep payments, events, voting, and member records organized in one
            secure workspace.
          </p>
        </div>
      </div>
    </div>
  </aside>
);

export default function LoginPage() {
  const navigate = useNavigate();
  return (
    <main className="min-h-screen bg-[#eef6fb] px-4 py-5 font-sans text-slate-900 sm:px-6 sm:py-8 lg:grid lg:place-items-center">
      {/* Auth shell: split this into layout + panel components once the design is final. */}
      <section className="mx-auto flex w-full max-w-[960px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl shadow-[#0b1831]/10 ring-1 ring-slate-200/70 lg:min-h-[620px] lg:flex-row">
        <BrandingPanel />

        {/* Login form area; the max width keeps labels, inputs, and links from crowding. */}
        <div className="relative flex flex-1 items-center bg-white px-6 py-9 sm:px-10 sm:py-12 lg:px-14">
          <div className="mx-auto w-full max-w-[370px]">
            <div className="mb-7">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#0b8ed0]">
                Secure login
              </p>
              <h2 className="text-2xl font-black text-slate-950 sm:text-[28px]">
                Welcome back!
              </h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                Sign in to access your account.
              </p>
            </div>

              <form className="space-y-4" onSubmit={async (event) => {
                event.preventDefault();
                const formData = new FormData(event.target);
                const credentials = {
                  school_id: formData.get('school_id'),
                  password: formData.get('password'),
                };
                try {
                  const response = await login(credentials);
                  localStorage.setItem('auth_token', response.data.access_token);
                  localStorage.setItem('user', JSON.stringify(response.data.user));
                  // Redirect or update UI as needed
                  navigate('/dashboard');
                } catch (error) {
                  console.error('Login failed:', error);
                }
              }}>
              <InputField
                label="School ID"
                name="school_id"
                type="text"
                placeholder="Enter your school ID"
                icon={Mail}
              />

              <InputField
                label="Password"
                name="password"
                type="password"
                placeholder="Enter your password"
                icon={Lock}
                isPassword
              />

              <div className="flex flex-col gap-3 pt-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  className="w-fit font-bold text-[#0878b7] transition hover:text-[#0b1831]"
                >
                  Forgot Password?
                </button>
              </div>

              <div className="pt-2">
                <PrimaryButton>Login</PrimaryButton>
              </div>
            </form>

            
          </div>
        </div>
      </section>
    </main>
  );
}
