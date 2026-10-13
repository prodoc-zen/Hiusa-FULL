import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ClipboardCheck, Users } from 'lucide-react';
import logo from '../../assets/Hiusa Logo.png';
import campusPhoto from '../../assets/landing-campus.jpg';
import studentsPhoto from '../../assets/landing-students.jpg';

const capabilities = [
  { icon: Users, title: 'People and roles', description: 'Keep members, officers, and organization responsibilities in one place.' },
  { icon: CalendarDays, title: 'Events and activities', description: 'Plan activities, request venues, and follow approvals.' },
  { icon: ClipboardCheck, title: 'Records and requirements', description: 'Track finances, compliance documents, elections, and clearances.' },
];

const registrationSteps = [
  { number: '01', title: 'Apply', description: 'An organization representative submits its details and verifies their email.' },
  { number: '02', title: 'Get endorsed', description: 'The Department Head reviews the application and may endorse it for SAO review.' },
  { number: '03', title: 'Receive a decision', description: 'SAO makes the final decision. On approval, the applicant receives administrator access.' },
];

export default function LandingPage() {
  return <div className="min-h-screen bg-[#EEF6FB] font-sans text-[#0F172A]">
    <header className="border-b border-[#DDE7EF] bg-white">
      <nav aria-label="Public navigation" className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" aria-label="HIUSA home" className="inline-flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]">
          <img src={logo} alt="" className="h-10 w-10 object-contain" />
          <span className="text-xl font-black text-[#0B1831]">HIUSA</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-6">
          <a href="#how-registration-works" className="hidden min-h-11 items-center text-sm font-semibold text-[#0F2F62] hover:text-[#0878B7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] sm:inline-flex">How it works</a>
          <Link to="/login" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#0878B7] px-4 text-sm font-bold text-[#0878B7] hover:bg-[#EEF6FB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] sm:px-5">Log in</Link>
        </div>
      </nav>
    </header>

    <main>
      <section aria-labelledby="landing-title" className="overflow-hidden bg-[#0B1831] text-white">
        <div className="mx-auto grid max-w-7xl lg:min-h-[550px] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative z-10 flex flex-col justify-center px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
            <p className="text-sm font-semibold text-[#75E5FF]">HIUSA · Student organization management</p>
            <h1 id="landing-title" className="mt-5 max-w-[12ch] text-4xl font-extrabold leading-[1.12] sm:text-5xl lg:text-[3.5rem]">From your first application to everyday campus work.</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-[#DCEAF5]">Register your organization, then manage members, events, finances, elections, and university requirements in one workspace.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link to="/register-organization" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#0878B7] px-6 py-3 text-sm font-bold text-white hover:bg-[#0F2F62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Register an organization <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link to="/login" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/70 px-6 py-3 text-sm font-bold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Log in</Link>
            </div>
          </div>
          <div className="relative min-h-64 sm:min-h-80 lg:min-h-full">
            <img src={campusPhoto} alt="Students together outside a university building" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover object-center" />
            <div aria-hidden="true" className="absolute inset-0 bg-[#0B1831]/20 lg:bg-gradient-to-r lg:from-[#0B1831]/50 lg:to-transparent" />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2 bg-[#0B8ED0] lg:inset-x-auto lg:inset-y-0 lg:left-0 lg:h-full lg:w-2" />
          </div>
        </div>
      </section>

      <section aria-labelledby="capabilities-title" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <h2 id="capabilities-title" className="text-2xl font-extrabold text-[#0B1831] sm:text-3xl">The work behind every organization</h2>
          <p className="mt-3 text-sm leading-6 text-[#475569] sm:text-base">HIUSA keeps the people, activities, and records of campus organizations connected.</p>
        </div>
        <div className="mt-8 grid gap-7 border-t border-[#C7D8E5] pt-7 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, description }) => <article key={title} className="max-w-sm">
            <Icon size={24} className="text-[#0878B7]" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-bold text-[#0B1831]">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-[#475569]">{description}</p>
          </article>)}
        </div>
      </section>

      <section id="how-registration-works" aria-labelledby="registration-title" className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16 lg:px-8">
          <div>
            <h2 id="registration-title" className="text-2xl font-extrabold text-[#0B1831] sm:text-3xl">How registration works</h2>
            <p className="mt-3 text-sm leading-6 text-[#475569] sm:text-base">The organization applies. The Department Head endorses. SAO makes the final decision.</p>
            <ol className="mt-7 divide-y divide-[#DDE7EF] border-y border-[#DDE7EF]">
              {registrationSteps.map(({ number, title, description }) => <li key={number} className="flex gap-4 py-4">
                <span className="shrink-0 text-sm font-extrabold text-[#0878B7]">{number}</span>
                <div><h3 className="text-sm font-bold text-[#0B1831]">{title}</h3><p className="mt-1 text-sm leading-6 text-[#475569]">{description}</p></div>
              </li>)}
            </ol>
            <Link to="/register-organization" className="mt-7 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#0878B7] hover:text-[#0F2F62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]">Start an application <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
          <img src={studentsPhoto} alt="Two students reviewing a document together" loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover object-center lg:aspect-[5/4]" />
        </div>
      </section>
    </main>

    <footer className="border-t border-[#DDE7EF] bg-[#EEF6FB] px-4 py-6 text-center text-xs leading-6 text-[#475569]">
      <p>HIUSA · Student organization management</p>
      <p>Campus imagery is illustrative. Photos by <a href="https://www.pexels.com/photo/group-of-students-at-university-campus-in-mexico-33265685/" className="underline hover:text-[#0878B7]">Raúl Sotomayor</a> and <a href="https://www.pexels.com/photo/asian-student-discussing-project-with-classmate-5553639/" className="underline hover:text-[#0878B7]">Armin Rimoldi</a> on Pexels.</p>
    </footer>
  </div>;
}
