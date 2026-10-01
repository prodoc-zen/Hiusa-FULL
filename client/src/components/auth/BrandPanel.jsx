import hiusaLogo from '../../assets/Hiusa Logo.png';
import { PILLARS } from '../../lib/pillars';

function FacetedMotif() {
  return (
    <svg
      viewBox="0 0 360 480"
      preserveAspectRatio="xMaxYMax slice"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.08]"
    >
      <polygon points="360,480 360,170 200,480" fill="white" />
      <polygon points="360,480 255,300 200,480" fill="#16C7F3" />
      <line x1="360" y1="170" x2="200" y2="480" stroke="white" strokeWidth="1.5" />
      <line x1="360" y1="480" x2="255" y2="300" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

export default function BrandPanel() {
  return (
    <aside className="relative flex w-full shrink-0 overflow-hidden bg-navy-950 px-6 py-5 text-white sm:px-10 sm:py-8 lg:w-[45%] lg:px-11 lg:py-10">
      <FacetedMotif />
      <div className="relative z-10 flex w-full flex-col">
        <div className="flex items-center gap-3">
          <img src={hiusaLogo} alt="HIUSA" className="h-10 w-10 object-contain sm:h-11 sm:w-11" />
          <span className="text-lg font-black tracking-wide">HIUSA</span>
        </div>

        <p className="mt-3 text-sm font-medium leading-6 text-slate-300 sm:hidden">
          One AI-assisted workspace for your student organization.
        </p>

        <div className="mt-8 hidden flex-1 flex-col justify-between sm:flex">
          <div className="max-w-[380px]">
            <h1 className="text-[26px] font-black leading-tight text-white lg:text-[32px]">
              One accountable platform for your student organization.
            </h1>
            <p className="mt-4 max-w-[340px] text-sm font-medium leading-6 text-slate-300">
              HIUSA brings finance, events, tasks, elections, merchandise, and communication into a single
              AI-assisted workspace, so every action stays visible and every decision explains itself.
            </p>
          </div>

          <ul className="mt-10 flex flex-wrap gap-x-5 gap-y-3">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <li key={pillar.key} className="flex items-center gap-2 text-[13px] font-semibold text-slate-300">
                  <Icon size={16} className="text-accent" aria-hidden="true" />
                  {pillar.shortLabel}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}
