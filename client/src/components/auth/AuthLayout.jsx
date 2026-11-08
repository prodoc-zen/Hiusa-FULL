import { Link } from 'react-router-dom';
import hiusaLogo from '../../assets/Hiusa Logo.png';

export default function AuthLayout({ children }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-page px-4 py-8 font-sans text-ink sm:py-12">
      <div className="w-full max-w-[420px]">
        <Link to="/" aria-label="HIUSA home" className="mb-6 inline-flex min-h-11 items-center gap-3 rounded-control">
          <img src={hiusaLogo} alt="" className="h-10 w-10 object-contain" />
          <span className="text-lg font-semibold text-ink">HIUSA</span>
        </Link>
        <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">{children}</div>
      </div>
    </main>
  );
}
