import BrandPanel from './BrandPanel';
import campusImage from '../../assets/uc-campus.jpeg';

export default function AuthLayout({ children, panelClassName = '' }) {
  return (
    <main className="route-fade-in relative isolate flex min-h-screen items-center justify-center bg-page bg-cover bg-center px-4 py-6 font-sans text-ink sm:px-6 sm:py-10" style={{ backgroundImage: `url(${campusImage})` }}>
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-navy-950/35" />
      <div className="mx-auto flex w-full max-w-[1040px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-raised lg:min-h-[640px] lg:flex-row">
        <BrandPanel />
        <div className={`flex flex-1 items-center justify-center px-6 py-8 sm:px-10 sm:py-12 lg:px-14 ${panelClassName}`}>
          <div className="w-full max-w-[370px]">{children}</div>
        </div>
      </div>
    </main>
  );
}
