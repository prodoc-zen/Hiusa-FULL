import { Link } from 'react-router-dom';
import { FlowStepper, NextStep } from '../ui';
import { organizationRegistrationLifecycle, toNextStepProps } from '../../lib/lifecycle';

function hasAdministrators(organization) {
  return organization.administrators_count !== undefined && organization.administrators_count !== null;
}

// lifecycle.js owns the stage logic. These titles only restate it in the words each role's list rows
// and callouts use, so a row and its detail drawer never disagree.
function titleFor(organization, viewerRole, fallback) {
  if (organization.lifecycle_status === 'pending') {
    return viewerRole === 'SUPER_ADMIN' ? 'Review this registration' : 'Pending review: waiting for SAO review';
  }
  if (organization.lifecycle_status !== 'active') return fallback;
  if (!hasAdministrators(organization)) return 'Active';
  if (Number(organization.administrators_count) === 0) {
    if (organization.is_university_wide) return viewerRole === 'SUPER_ADMIN' ? 'Add the Admin account' : 'Approved: waiting for SAO to add the Admin account';
    return viewerRole === 'DEPARTMENT_HEAD' ? 'Name the organization head' : 'Approved: waiting for the Department Head to name the organization head';
  }
  return 'Active: administrator can sign in';
}

export function registrationView(organization, viewerRole) {
  const lifecycle = organizationRegistrationLifecycle(organization, viewerRole);
  const nextStep = toNextStepProps(lifecycle);
  const remarksForSao = viewerRole === 'SUPER_ADMIN' && organization.lifecycle_status === 'returned' && Boolean(organization.review_remarks);
  return {
    lifecycle,
    nextStep: {
      ...nextStep,
      title: titleFor(organization, viewerRole, nextStep.title),
      body: remarksForSao ? `Your remarks: ${organization.review_remarks}` : nextStep.body,
    },
  };
}

export function RegistrationStepper({ organization, viewerRole, variant = 'full', className = '' }) {
  const { lifecycle } = registrationView(organization, viewerRole);
  const steps = organization.is_university_wide ? lifecycle.steps.map((step) => step.key === 'registered' ? { ...step, label: 'College endorsement', actor: null, state: 'skipped', note: 'Not required for a unified organization' } : step) : lifecycle.steps;
  return <div className={className}><FlowStepper steps={steps} variant={variant} ariaLabel={`Registration progress for ${organization.name}`} />{variant === 'full' && organization.is_university_wide && <p className="mt-3 text-xs text-ink-muted-strong">SAO approves unified organizations directly and adds the Admin account.</p>}</div>;
}

const LINE_TONE = {
  action: 'text-brand-700',
  waiting: 'text-warning-strong',
  blocked: 'text-danger-strong',
  done: 'text-success-strong',
};

// What a list row says about a registration: who owns the next move in words, then the compact
// stepper. The text is always present so the stage never rests on color alone. linkToAction makes the sentence a link to the
// target the callout's button opens, for a viewer who owns the next move.
export function RegistrationRowStatus({ organization, viewerRole, linkToAction = false, className = '' }) {
  const { nextStep } = registrationView(organization, viewerRole);
  const toneClass = `text-xs font-medium ${LINE_TONE[nextStep.tone] ?? 'text-ink'}`;
  return (
    <div className={`space-y-1.5 ${className}`}>
      {linkToAction && nextStep.tone === 'action' && nextStep.primary?.to
        ? <p className={toneClass}><Link to={nextStep.primary.to} className="inline-flex min-h-11 items-center rounded-control underline underline-offset-2 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">{nextStep.title}</Link></p>
        : <p className={toneClass}>{nextStep.title}</p>}
      <RegistrationStepper organization={organization} viewerRole={viewerRole} variant="compact" />
    </div>
  );
}

// onPrimary swaps the callout's link for a handler when the action happens on the same page.
export function RegistrationNextStep({ organization, viewerRole, onPrimary, className = '' }) {
  const { nextStep } = registrationView(organization, viewerRole);
  const primary = onPrimary && nextStep.primary ? { label: nextStep.primary.label, onClick: onPrimary } : nextStep.primary;
  return <NextStep {...nextStep} primary={primary} className={className} />;
}
