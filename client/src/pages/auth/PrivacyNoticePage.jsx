import { Link } from 'react-router-dom';
import logo from '../../assets/Hiusa Logo.png';
import { PRIVACY_NOTICE_VERSION } from '../../utils/privacyNotice';

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-lg font-semibold text-navy-950">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-ink">{children}</div>
    </section>
  );
}

function Bullets({ items }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

export default function PrivacyNoticePage() {
  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <header className="border-b border-line bg-white">
        <nav aria-label="Public navigation" className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" aria-label="HIUSA home" className="inline-flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
            <img src={logo} alt="" className="h-10 w-10 object-contain" />
            <span className="text-xl font-semibold text-navy-950">HIUSA</span>
          </Link>
          <Link to="/login" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-brand-700 px-4 text-sm font-bold text-brand-700 hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Sign in</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-2xl font-semibold text-navy-950 sm:text-3xl">Data Privacy Notice</h1>
        <p className="mt-2 text-sm text-ink-muted">Version {PRIVACY_NOTICE_VERSION}. Read this before you make an account or keep using HIUSA.</p>

        <Section id="privacy-who" title="Who handles your data">
          <p>
            HIUSA is the student organization system of the University of Cebu. The Student Affairs Office (SAO) runs it and is responsible for the personal data in it.
            This notice follows Republic Act No. 10173, the Data Privacy Act of 2012.
          </p>
        </Section>

        <Section id="privacy-collect" title="What the system collects">
          <Bullets
            items={[
              'Your account: school ID, name, email, contact number, college, program, year level and section, your role, and your photo if you add one.',
              'Your birth date. It comes from the school records and is used once, to match you when you sign up. No screen shows it.',
              'Your activity in organizations: memberships and positions, tasks, event registration and attendance, merchandise orders, clearances, and elections, including whether you voted and any candidacy application you file.',
              'Finance records: fees and payments you make, receipts, invoices and cash advances in your name, and the income and expense records of an organization you help run.',
              'Grievances you file, with the text you write, any files you attach, and the decisions made on them.',
              'Fingerprint templates, only if an Admin or SBO Officer enrolls you for event attendance and you confirm it. A template is made from your fingerprint scans and is used only to confirm you attended. No screen shows it.',
              'Records of what people do in the system, such as approvals, changes and sign-ins, kept as an audit trail.',
              'What you type to the Ask AI assistant, and drafting help, when you use them.',
            ]}
          />
        </Section>

        <Section id="privacy-why" title="Why we collect it">
          <Bullets
            items={[
              'To make your account and tell you apart from other students and staff.',
              'To run student organizations: membership, events, approvals, elections, orders and clearances.',
              'To keep organization money accountable to the school and to the members who paid it.',
              'To handle grievances and protect students.',
              'To keep the system secure and to show who did what, if a decision is questioned.',
              'To help you with the AI features. Some features, such as the Ask AI assistant and drafting help, send your question and a limited set of facts to an outside AI service to write a reply. A person reads every draft and decides what to do with it.',
            ]}
          />
          <p>We do not sell your data and we do not use it for advertising.</p>
        </Section>

        <Section id="privacy-who-sees" title="Who can see it">
          <Bullets
            items={[
              'You see your own account and records.',
              'Officers and the Admin of an organization see the members of that organization and its events, tasks and finance records.',
              'The Department Head and office staff of a college see the students, organizations and submitted files of that college.',
              'The SAO sees records across the University, including audit records.',
              'A grievance goes to your organization Admin or straight to the SAO, as you choose. If you file it anonymously, your organization Admin does not see your name. The SAO always can, so it can follow up with you.',
            ]}
          />
          <p>People outside these roles do not see your records, unless the law or a lawful order requires the University to share them.</p>
        </Section>

        <Section id="privacy-keep" title="How long we keep it">
          <p>
            We keep your account and records while you are a student or employee of the University, and afterwards for as long as the University&apos;s records rules require.
            Approvals, finance and the audit trail have to stay accurate, so a closed account is disabled, not wiped.
            The system does not delete records on a timer. Ask the SAO which period applies to a record.
          </p>
        </Section>

        <Section id="privacy-protect" title="How we protect it">
          <p>
            Passwords are stored in a form nobody can read. What you can open depends on your role. A sign-in ends after four hours. Changes are written to an audit trail.
          </p>
        </Section>

        <Section id="privacy-rights" title="Your rights">
          <p>Under the Data Privacy Act of 2012 you have the right to:</p>
          <Bullets
            items={[
              'be informed about how your data is handled, which is what this notice is for;',
              'ask for a copy of the personal data we hold about you;',
              'object to the processing of your data, or withdraw your agreement;',
              'have wrong or out of date data corrected;',
              'ask for your data to be blocked or removed, where the law allows it;',
              'receive your data in a form you can use elsewhere;',
              'claim compensation if you were harmed by misuse of your data; and',
              'complain to the National Privacy Commission.',
            ]}
          />
          <p>Some records cannot be removed while the University still has to keep them, such as finance records and the audit trail.</p>
        </Section>

        <Section id="privacy-contact" title="Who to contact">
          <p>
            Take any request or question about your personal data to the Student Affairs Office of the University of Cebu. Show your school ID so the office can find your record.
          </p>
        </Section>

        <Section id="privacy-changes" title="Changes to this notice">
          <p>If this notice changes in a way that matters, the version above changes and you will be asked to read it again.</p>
        </Section>

        <p className="mt-10 border-t border-line pt-4 text-sm text-ink-muted">
          <Link to="/login" className="inline-flex min-h-[42px] items-center font-semibold text-brand-700 underline hover:text-brand-800">Back to sign in</Link>
        </p>
      </main>
    </div>
  );
}
