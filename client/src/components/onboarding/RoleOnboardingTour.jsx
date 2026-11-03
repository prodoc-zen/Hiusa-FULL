import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  Compass,
  ExternalLink,
  MousePointerClick,
  Pause,
  Play,
  X,
} from 'lucide-react';

const ROLE_NAMES = {
  SUPER_ADMIN: 'SAO / University Regulator',
  DEPARTMENT_HEAD: 'Department Head / College Dean',
  ADMIN: 'Organization Admin / President',
  SBO_OFFICER: 'SBO Officer',
  STUDENT: 'Student Member',
};

const ROLE_TOURS = {
  SUPER_ADMIN: [
    {
      id: 'sao-overview',
      title: 'SAO University-Wide Command Center',
      selector: '[data-tour="briefing-header"], main h1, main h2',
      whatItDoes: 'Displays university-wide governance priorities across all colleges and accredited student organizations.',
      whatToSay: 'The SAO role is the highest university regulator—overseeing all colleges, academic terms, compliance, venues, grievances, and final clearances.',
      route: '/dashboard/super-admin',
      actionLabel: 'View SAO Dashboard',
    },
    {
      id: 'sao-ai-spotlight',
      title: 'SAO Ask AI Operations Copilot',
      selector: '[data-tour="ask-ai-spotlight"]',
      whatItDoes: 'Synthesizes live database records across 10 university domains into HTML tables, progress bars, and visual comparison charts.',
      whatToSay: 'Right from the dashboard, SAO can ask open-ended questions like who has not submitted requirements or which items await approval.',
      route: '/dashboard/super-admin',
      actionLabel: 'Focus AI Copilot',
    },
    {
      id: 'sao-academic-terms',
      title: '1. Create Academic Years & Semesters',
      selector: 'aside a[href*="/academic-terms"], aside a[href*="/academic-years"]',
      whatItDoes: 'Opens and closes university Academic Years and Semesters. Activating a semester automatically scaffolds default accreditation and event checklists.',
      whatToSay: 'From a clean slate, SAO starts here by creating the Academic Year (e.g., 2026-2027) and activating the 1st Semester.',
      route: '/dashboard/super-admin/academic-terms',
      actionLabel: 'Open Academic Years',
    },
    {
      id: 'sao-compliance',
      title: '2. Publish Accreditation Requirements & Templates',
      selector: 'aside a[href*="/super-admin/compliance"]',
      whatItDoes: 'Lets SAO attach official sample PDF formats, set deadlines, and activate registration requirements so organizations can apply.',
      whatToSay: 'Next, SAO publishes the semester requirements with sample PDF formats and reviews uploaded compliance documents and financial reports.',
      route: '/dashboard/super-admin/compliance',
      actionLabel: 'Open Compliance Setup',
    },
    {
      id: 'sao-colleges',
      title: '3. Manage Colleges & Invite Deans (Magic Link)',
      selector: 'aside a[href*="/super-admin/colleges"]',
      whatItDoes: 'Creates academic colleges and provisions Department Heads (Deans) via instant 1-click magic onboarding links or branded HTML emails.',
      whatToSay: 'Here SAO manages academic colleges and provisions Deans either directly or by generating a copyable magic link and branded invitation email.',
      route: '/dashboard/super-admin/colleges',
      actionLabel: 'Open Colleges',
    },
    {
      id: 'sao-organizations',
      title: '4. Approve Organizations & Provision Presidents',
      selector: 'aside a[href*="/super-admin/organizations"]',
      whatItDoes: 'Reviews organization registrations submitted by Deans, approves them into active status, and creates their initial Organization Admin account.',
      whatToSay: 'Once a Dean registers a student organization, SAO approves it here and provisions the Student President’s Admin account.',
      route: '/dashboard/super-admin/organizations',
      actionLabel: 'Open Organizations',
    },
  ],
  DEPARTMENT_HEAD: [
    {
      id: 'dean-overview',
      title: 'College Dean Governance Workspace',
      selector: '[data-tour="briefing-header"], main h1, main h2',
      whatItDoes: 'Scopes all metrics, approvals, and compliance tracking strictly to student organizations under your academic college.',
      whatToSay: 'As Department Head of the College of Computer Studies, multi-tenant isolation scopes my workspace strictly to CCS organizations.',
      route: '/dashboard/department-head',
      actionLabel: 'View College Dashboard',
    },
    {
      id: 'dean-ai-spotlight',
      title: 'College-Scoped Ask AI Copilot',
      selector: '[data-tour="ask-ai-spotlight"]',
      whatItDoes: 'Answers questions about which college organizations have or have not submitted requirements, budgets, or event proposals.',
      whatToSay: 'I can ask the AI Copilot which organizations in my college are missing requirements or waiting for my endorsement.',
      route: '/dashboard/department-head',
      actionLabel: 'Focus AI Copilot',
    },
    {
      id: 'dean-organizations',
      title: 'Register & Oversee College Organizations',
      selector: 'aside a[href*="/department-head/organizations"]',
      whatItDoes: 'Lets the Dean register new student organizations for their college, attach required PDFs, and monitor registration status.',
      whatToSay: 'Here the Dean clicks "Register organization" to create a new student organization under their college and submit it to SAO.',
      route: '/dashboard/department-head/organizations',
      actionLabel: 'Open College Orgs',
    },
    {
      id: 'dean-applications',
      title: 'Endorse Public Student Founder Applications',
      selector: 'aside a[href*="/organization-applications"]',
      whatItDoes: 'Reviews organization charter applications submitted by founding students from the public landing page and endorses them to SAO.',
      whatToSay: 'When students apply from the public portal, their application lands here first for the Dean’s academic endorsement.',
      route: '/dashboard/organization-applications',
      actionLabel: 'Open Applications',
    },
    {
      id: 'dean-approvals',
      title: 'Stage 1 Endorsement Queue (Budgets, Events & Reports)',
      selector: 'aside a[href*="/approvals"]',
      whatItDoes: 'Reviews and endorses student organization budgets, event proposals, and financial reports before they can advance to SAO.',
      whatToSay: 'Nothing from a student organization reaches the SAO without first passing through the Dean’s Stage 1 Approval Inbox.',
      route: '/dashboard/department-head/approvals',
      actionLabel: 'Open Approvals Inbox',
    },
    {
      id: 'dean-clearances',
      title: 'Stage 2 College Clearance Signing',
      selector: 'aside a[href*="/clearances"]',
      whatItDoes: 'Signs or places holds on student clearances at the College Dean stage after the student organization clears the member.',
      whatToSay: 'The Dean also signs the second stage of student clearances before final SAO sign-off.',
      route: '/dashboard/department-head/clearances',
      actionLabel: 'Open Clearance Signing',
    },
    {
      id: 'dean-subaccount',
      title: 'GoHighLevel-Style Sub-Account Context Switcher',
      selector: '[data-tour="topbar-subaccount"], [data-tour="topbar-tour-btn"]',
      whatItDoes: 'Allows the Dean to switch context into any student organization under their college in 1 click to oversee ledgers, events, and rosters without logging out or juggling accounts.',
      whatToSay: 'Modeled after GoHighLevel sub-accounts, the Dean can jump directly into any student organization under their college with zero login friction, while maintaining full institutional oversight.',
      route: '/dashboard/department-head/organizations',
      actionLabel: 'View Sub-Accounts',
    },
    {
      id: 'dean-staff',
      title: "Dean's Office Staff & College Secretary Delegation",
      selector: '[data-tour="dean-staff-btn"], aside a[href*="/department-head/organizations"]',
      whatItDoes: 'Allows the Dean to appoint College Secretaries and Administrative Assistants with ADMIN or DEPARTMENT_HEAD authority to assist with endorsements, compliance, and records.',
      whatToSay: 'The Dean can delegate administrative authority to their College Secretary or office assistant, giving them full modifying access to assist with operations.',
      route: '/dashboard/department-head/organizations',
      actionLabel: 'Open College Orgs',
    },
    {
      id: 'dean-advance-planning',
      title: 'Academic Period & Advance Planning Switcher',
      selector: '[data-tour="topbar-period"]',
      whatItDoes: 'Lets Deans switch between the live active term and upcoming school years/semesters to prepare budgets, proposals, and requirements in advance.',
      whatToSay: 'In the top bar, Deans can switch to upcoming terms in advance planning mode, enabling early budget drafting and event scheduling.',
      route: null,
      actionLabel: 'Focus Period Switcher',
    },
  ],
  ADMIN: [
    {
      id: 'admin-overview',
      title: 'Organization President Command Center',
      selector: '[data-tour="briefing-header"], main h1, main h2',
      whatItDoes: 'Provides full executive control over a single accredited student organization (members, finances, events, tasks, elections, and store).',
      whatToSay: 'As Organization Admin (President of PSITS-CCS), this is our 360-degree command center isolated by organization_id.',
      route: '/dashboard/admin',
      actionLabel: 'View Admin Dashboard',
    },
    {
      id: 'admin-ai-spotlight',
      title: 'Organization Ask AI & Semantic RAG Copilot',
      selector: '[data-tour="ask-ai-spotlight"]',
      whatItDoes: 'Searches live organization records—officers, budgets, ledger transactions, events, tasks, merchandise stock, and elections.',
      whatToSay: 'I can ask combined questions about our officer roster, budget utilization, or low merchandise stock and get instant charts and tables.',
      route: '/dashboard/admin',
      actionLabel: 'Focus AI Copilot',
    },
    {
      id: 'admin-users',
      title: 'Members, SBO Officers & Biometric Enrollment',
      selector: 'aside a[href*="/users"]',
      whatItDoes: 'Manages student members, appoints SBO officers, and enrolls DigitalPersona biometric fingerprint templates for event check-in.',
      whatToSay: 'Here we manage our member directory, assign officer positions, and enroll student fingerprints for tamper-proof attendance.',
      route: '/dashboard/admin/users',
      actionLabel: 'Open People & Members',
    },
    {
      id: 'admin-finance',
      title: 'Auditable Financial Suite & AI Forecasting',
      selector: 'aside a[href*="/finance"], aside button:has-text("Finance")',
      whatItDoes: 'Manages semester budgets, double-entry ledger transactions with receipts, cash advances, student fee invoices, and OLS AI financial forecasting.',
      whatToSay: 'Every peso is tracked with official receipts, AI Budget Advisory, and Ordinary Least Squares financial forecasting.',
      route: '/dashboard/finance/budget-allocation',
      actionLabel: 'Open Finance Suite',
    },
    {
      id: 'admin-events',
      title: 'Event Proposals, Venue Booking & Evaluations',
      selector: 'aside a[href*="/events"], aside button:has-text("Events")',
      whatItDoes: 'Creates event proposals, books campus venues, uploads mandatory event requirement PDFs, and tracks student evaluations.',
      whatToSay: 'We propose campus events, reserve venues, attach required permits, and route them to the Dean and SAO for approval.',
      route: '/dashboard/events/manage-events',
      actionLabel: 'Open Events',
    },
    {
      id: 'admin-tasks',
      title: 'AI-Assisted Task Delegation Board',
      selector: 'aside a[href*="/tasks"]',
      whatItDoes: 'Scores officers across Position Fit (35%), Workload (30%), Completion Rate (20%), and Recency (15%) to recommend the best assignee.',
      whatToSay: 'Our AI Task Delegation Engine recommends the best officer for each task with transparent mathematical scoring.',
      route: '/dashboard/tasks/task-board',
      actionLabel: 'Open Task Board',
    },
  ],
  SBO_OFFICER: [
    {
      id: 'officer-overview',
      title: 'SBO Officer Operational Workspace',
      selector: '[data-tour="briefing-header"], main h1, main h2',
      whatItDoes: 'Tailored for day-to-day officer execution—highlighting assigned tasks, pending merchandise orders, and upcoming event check-ins.',
      whatToSay: 'SBO Officers like the Treasurer or Secretary get a focused execution workspace without exposing destructive admin settings.',
      route: '/dashboard/officer',
      actionLabel: 'View Officer Dashboard',
    },
    {
      id: 'officer-ai',
      title: 'Officer Ask AI Queue Assistant',
      selector: '[data-tour="ask-ai-spotlight"]',
      whatItDoes: 'Surfaces overdue tasks, unverified merchandise orders, and clearance queues in formatted tables and charts.',
      whatToSay: 'Officers can ask the AI Copilot what orders need payment verification or which assigned tasks are due soon.',
      route: '/dashboard/officer',
      actionLabel: 'Focus AI Copilot',
    },
    {
      id: 'officer-tasks',
      title: 'Assigned Tasks & Milestone Progress',
      selector: 'aside a[href*="/tasks"]',
      whatItDoes: 'Lets officers update task completion percentages (0%–100%) and log milestone notes for the President.',
      whatToSay: 'Here officers update their task progress percentages and log completion notes.',
      route: '/dashboard/tasks/assigned-tasks',
      actionLabel: 'Open My Tasks',
    },
    {
      id: 'officer-orders',
      title: 'Merchandise Order & GCash Verification',
      selector: 'aside a[href*="/merchandise"]',
      whatItDoes: 'Verifies student GCash payment proofs, approves orders, and marks merchandise as claimed via claim tokens.',
      whatToSay: 'The Treasurer verifies student payment proofs here and releases claimed organization merchandise.',
      route: '/dashboard/merchandise/manage-orders',
      actionLabel: 'Open Manage Orders',
    },
    {
      id: 'officer-clearances',
      title: 'Stage 1 Organization Clearance Signing',
      selector: 'aside a[href*="/clearances"]',
      whatItDoes: 'Clears or places holds on student members at the initial Student Organization clearance stage.',
      whatToSay: 'Officers sign the first stage of student clearances once membership fees and event obligations are settled.',
      route: '/dashboard/clearances',
      actionLabel: 'Open Clearances',
    },
  ],
  STUDENT: [
    {
      id: 'student-overview',
      title: 'Student Self-Service Portal',
      selector: '[data-tour="briefing-header"], main h1, main h2',
      whatItDoes: 'Gives every student member real-time visibility into their clearance status, financial account, events, elections, and store orders.',
      whatToSay: 'The Student Portal gives members complete self-service transparency strictly scoped to their own personal records.',
      route: '/dashboard/student',
      actionLabel: 'View Student Portal',
    },
    {
      id: 'student-ai',
      title: 'Personal Ask AI Assistant',
      selector: '[data-tour="ask-ai-spotlight"]',
      whatItDoes: 'Answers personal questions like "Who hasn’t signed my clearance?" or "What fees do I owe?" with zero exposure of other students’ data.',
      whatToSay: 'Students can ask their Personal AI Assistant why their clearance is on hold or how much they owe in organization fees.',
      route: '/dashboard/student',
      actionLabel: 'Focus Personal AI',
    },
    {
      id: 'student-clearance',
      title: '3-Stage Clearance Tracker',
      selector: 'aside a[href*="/my-clearance"]',
      whatItDoes: 'Tracks clearance signatures across Stage 1 (Organization), Stage 2 (Department Head), and Stage 3 (SAO) with exact hold reasons.',
      whatToSay: 'Students see all three clearance stages in real time along with any specific hold remarks.',
      route: '/dashboard/my-clearance',
      actionLabel: 'Open My Clearance',
    },
    {
      id: 'student-soa',
      title: 'Personal Statement of Account & Receipts',
      selector: 'aside a[href*="/statement-of-account"]',
      whatItDoes: 'Shows unpaid organization fee invoices, payment history, and downloadable official receipts.',
      whatToSay: 'Here students inspect their Statement of Account, open fee balances, and official receipts.',
      route: '/dashboard/finance/statement-of-account',
      actionLabel: 'Open Statement of Account',
    },
    {
      id: 'student-elections',
      title: 'One-Student-One-Vote Elections & Store',
      selector: 'aside a[href*="/elections"]',
      whatItDoes: 'Allows students to view candidate platforms, cast a secure ballot, order org merchandise, and submit confidential grievances.',
      whatToSay: 'Students can also vote in student council elections, order merchandise, evaluate events, and file grievances.',
      route: '/dashboard/elections',
      actionLabel: 'Open Elections',
    },
  ],
};

const CREATION_TOUR = [
  {
    id: 'create-step-1',
    title: 'Step 1: Create Academic Year & Activate Semester (SAO)',
    selector: 'aside a[href*="/academic-terms"], aside a[href*="/academic-years"], [data-tour="topbar-period"]',
    whatItDoes: 'SAO creates the Academic Year (e.g., 2026-2027), adds 1st Semester, and clicks Activate to scaffold default requirements.',
    whatToSay: 'To build from a clean slate, SAO first creates the Academic Year and activates the 1st Semester.',
    route: '/dashboard/super-admin/academic-terms',
    actionLabel: 'Go to Academic Years',
  },
  {
    id: 'create-step-2',
    title: 'Step 2: Attach Sample PDF & Activate Requirement (SAO)',
    selector: 'aside a[href*="/super-admin/compliance"], [data-tour="topbar-tour-btn"]',
    whatItDoes: 'In Compliance -> Requirement settings, SAO attaches a sample PDF from demo-sample-files/ and toggles the requirement Active.',
    whatToSay: 'Activating at least one requirement with a sample PDF opens organization registration across the university.',
    route: '/dashboard/super-admin/compliance',
    actionLabel: 'Go to Compliance Settings',
  },
  {
    id: 'create-step-3',
    title: 'Step 3: Register College Organization with Founding President',
    selector: 'aside a[href*="/organizations"], [data-tour="briefing-header"]',
    whatItDoes: 'The College Dean registers the organization, uploads requirement files, and designates the Founding Student President (Marco Dela Cruz 900001) in a streamlined 2-step form.',
    whatToSay: "In HIUSA's streamlined 2-step registration, the Dean enters the organization details, founding President credentials, and registration documents simultaneously.",
    route: '/dashboard/department-head/organizations',
    actionLabel: 'Open Org Registration',
  },
  {
    id: 'create-step-4',
    title: 'Step 4: SAO 1-Click Approval & Auto-Provisioned President',
    selector: 'aside a[href*="/super-admin/organizations"], [data-tour="briefing-header"]',
    whatItDoes: 'SAO reviews the uploaded PDF files and clicks "Approve". The organization is instantly activated and Marco Dela Cruz is auto-provisioned as President in ONE step (no manual handover needed).',
    whatToSay: 'Approving the registration simultaneously activates the organization and provisions the President account with zero manual hand-off steps.',
    route: '/dashboard/super-admin/organizations',
    actionLabel: 'Open SAO Org Review',
  },
  {
    id: 'create-step-5',
    title: 'Step 5: Query the New Organization in Ask AI',
    selector: 'aside a[href*="/ask-ai"], [data-tour="ask-ai-spotlight"]',
    whatItDoes: 'Ask AI immediately indexes the newly created organization, its officers, compliance status, and records via live Semantic RAG.',
    whatToSay: 'Because our Ask AI engine uses live database RAG, we can immediately ask it questions about the organization we just created!',
    route: '/dashboard/ask-ai',
    actionLabel: 'Open Ask AI Copilot',
  },
];

const AI_TOUR = [
  {
    id: 'ai-step-1',
    title: 'Inline Dashboard Ask AI Spotlight',
    selector: '[data-tour="ask-ai-spotlight"]',
    whatItDoes: 'Gives every role 1-click prompt chips and an instant inline briefing with HTML tables and CSS comparison charts.',
    whatToSay: 'Every role has an inline Ask AI Spotlight right on their dashboard for immediate triage.',
    route: null,
    actionLabel: null,
  },
  {
    id: 'ai-step-2',
    title: 'Dedicated Ask AI Semantic RAG Workspace',
    selector: 'aside a[href*="/ask-ai"], [data-tour="topbar-ai-btn"]',
    whatItDoes: 'Opens the full-screen Ask AI workspace with Hybrid Semantic Search (BM25 + 12D Concept Vectors + Entity Matching), multi-domain tables, and visual charts.',
    whatToSay: 'Clicking Ask AI opens the full Semantic RAG workspace where you can ask any custom question across 10 live domains.',
    route: '/dashboard/ask-ai',
    actionLabel: 'Open Full Ask AI Page',
  },
];

function findTargetElement(selectorList) {
  if (!selectorList || typeof document === 'undefined') return null;
  const selectors = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return el;
      }
    } catch {
      // ignore invalid selector
    }
  }
  return null;
}

export default function RoleOnboardingTour({ role = 'ADMIN', open, onClose }) {
  const [track, setTrack] = useState('role');
  const [stepIndex, setStepIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  const steps = useMemo(() => {
    if (track === 'creation') return CREATION_TOUR;
    if (track === 'ai') return AI_TOUR;
    return ROLE_TOURS[role] || ROLE_TOURS.ADMIN;
  }, [role, track]);

  const safeIndex = Math.min(stepIndex, Math.max(0, steps.length - 1));
  const currentStep = steps[safeIndex] || steps[0];

  const updateHighlight = useCallback(() => {
    if (!open || !currentStep) return;
    const el = findTargetElement(currentStep.selector);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setTargetRect({
      top: Math.max(8, rect.top - 6),
      left: Math.max(8, rect.left - 6),
      width: Math.min(window.innerWidth - 16, rect.width + 12),
      height: Math.min(window.innerHeight - 16, rect.height + 12),
      cursorX: Math.min(window.innerWidth - 48, Math.max(24, rect.left + Math.min(rect.width * 0.65, 180))),
      cursorY: Math.min(window.innerHeight - 48, Math.max(24, rect.top + Math.min(rect.height * 0.55, 36))),
    });
  }, [open, currentStep]);

  useEffect(() => {
    if (!open || !currentStep) return undefined;
    const el = findTargetElement(currentStep.selector);
    if (el && typeof el.scrollIntoView === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect.top < 70 || rect.bottom > window.innerHeight - 70) {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch {
          // ignore
        }
      }
    }
    const timer = setTimeout(updateHighlight, 120);
    updateHighlight();
    window.addEventListener('resize', updateHighlight);
    window.addEventListener('scroll', updateHighlight, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateHighlight);
      window.removeEventListener('scroll', updateHighlight, true);
    };
  }, [open, currentStep, location.pathname, updateHighlight]);

  useEffect(() => {
    if (!open || !autoPlay) return undefined;
    const interval = setInterval(() => {
      setStepIndex((prev) => {
        if (prev + 1 < steps.length) return prev + 1;
        setAutoPlay(false);
        return prev;
      });
    }, 5200);
    return () => clearInterval(interval);
  }, [open, autoPlay, steps.length]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight') setStepIndex((i) => Math.min(steps.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setStepIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, steps.length]);

  if (!open || !currentStep) return null;

  const cursorX = targetRect?.cursorX ?? Math.round(window.innerWidth * 0.5);
  const cursorY = targetRect?.cursorY ?? Math.round(window.innerHeight * 0.32);

  function switchTrack(nextTrack) {
    setTrack(nextTrack);
    setStepIndex(0);
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[90]" role="dialog" aria-modal="false" aria-label="Interactive role onboarding tour">
      {/* Spotlight Highlight Frame around Target Element */}
      {targetRect && (
        <div
          aria-hidden="true"
          style={{
            transform: `translate3d(${targetRect.left}px, ${targetRect.top}px, 0)`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
            transition: 'transform 420ms cubic-bezier(0.23, 1, 0.32, 1), opacity 240ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
          className="pointer-events-none fixed left-0 top-0 z-[91] rounded-xl border-2 border-[#0878B7] shadow-[0_0_0_9999px_rgba(11,24,49,0.45)] motion-reduce:transition-none"
        />
      )}

      {/* Animated Guiding Pointer Cursor + Ripple */}
      <div
        aria-hidden="true"
        style={{
          transform: `translate3d(${cursorX}px, ${cursorY}px, 0)`,
          transition: 'transform 520ms cubic-bezier(0.23, 1, 0.32, 1)',
        }}
        className="pointer-events-none fixed left-0 top-0 z-[93] motion-reduce:transition-none"
      >
        <span className="absolute -left-1.5 -top-1.5 h-6 w-6 rounded-full border-2 border-[#0878B7] bg-[#0878B7]/20" />
        <svg width="30" height="30" viewBox="0 0 28 28" fill="none" className="relative drop-shadow-[0_6px_12px_rgba(11,24,49,0.45)]">
          <path
            d="M4.5 3.5L13.5 24.5L16.8 16.8L24.5 13.5L4.5 3.5Z"
            fill="#0878B7"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </svg>
        <div className="mt-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#16C7F3]/60 bg-[#0B1831] px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">
          <MousePointerClick size={12} className="text-[#16C7F3]" />
          <span>Step {safeIndex + 1}: {currentStep.title}</span>
        </div>
      </div>

      {/* Interactive Coachmark HUD Card (Bottom-Right Docked so it never blocks center tables/modals) */}
      <aside className="pointer-events-auto fixed bottom-4 right-4 z-[95] w-[calc(100vw-2rem)] max-w-[430px] overflow-hidden rounded-2xl border border-[#0B8ED0]/40 bg-[#0B1831] text-white shadow-2xl">
        {/* Top Track Switcher Bar */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#0F2F62]/80 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => switchTrack('role')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                track === 'role' ? 'bg-[#0878B7] text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Compass size={12} />
              Role Guide
            </button>
            <button
              type="button"
              onClick={() => switchTrack('creation')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                track === 'creation' ? 'bg-[#0878B7] text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Building2 size={12} />
              Create Org & Term
            </button>
            <button
              type="button"
              onClick={() => switchTrack('ai')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                track === 'ai' ? 'bg-[#0878B7] text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Bot size={12} />
              Ask AI Guide
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close interactive tour"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-[#16C7F3]">
            <span>{ROLE_NAMES[role] || role}</span>
            <span>Step {safeIndex + 1} of {steps.length}</span>
          </div>

          <h3 className="mt-1.5 text-base font-extrabold leading-snug text-white">
            {currentStep.title}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
            {currentStep.whatItDoes}
          </p>

          {currentStep.whatToSay && (
            <div className="mt-3 rounded-xl border border-[#16C7F3]/30 bg-[#0F2F62]/60 p-3">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#16C7F3]">
                Presenter / Demo Script
              </p>
              <p className="mt-1 text-xs italic leading-relaxed text-slate-100">
                &ldquo;{currentStep.whatToSay}&rdquo;
              </p>
            </div>
          )}

          {currentStep.route && location.pathname !== currentStep.route && (
            <button
              type="button"
              onClick={() => navigate(currentStep.route)}
              className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[#16C7F3]/50 bg-[#0878B7]/30 px-3 py-2 text-xs font-bold text-white transition hover:bg-[#0878B7]"
            >
              <ExternalLink size={13} />
              {currentStep.actionLabel || 'Open this page now'}
            </button>
          )}

          {/* Progress Dots & Controls */}
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
            <div className="flex items-center gap-1.5">
              {steps.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Go to step ${idx + 1}`}
                  onClick={() => setStepIndex(idx)}
                  className={`h-2 rounded-full transition-all ${
                    idx === safeIndex ? 'w-6 bg-[#16C7F3]' : 'w-2 bg-white/25 hover:bg-white/50'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAutoPlay((v) => !v)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
              >
                {autoPlay ? <Pause size={12} /> : <Play size={12} />}
                {autoPlay ? 'Pause' : 'Auto'}
              </button>
              <button
                type="button"
                disabled={safeIndex === 0}
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                aria-label="Previous step"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/5 text-white transition hover:bg-white/10 disabled:opacity-35"
              >
                <ArrowLeft size={14} />
              </button>
              {safeIndex < steps.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#0878B7] px-3 text-xs font-bold text-white transition hover:bg-[#0B8ED0]"
                >
                  Next
                  <ArrowRight size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-500"
                >
                  <CheckCircle2 size={13} />
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
