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
    return viewerRole === 'SUPER_ADMIN' ? 'Add the first Admin account' : 'Approved: waiting for SAO to add the first Admin account';
  }
  return 'Active: administrator can sign in';
}

export function registrationView(organization, viewerRole) {
  const lifecycle = organizationRegistrationLifecycle(organization, viewerRole);
  const nextStep = toNextStepProps(lifecycle);
  const remarksForSao = viewerRole === 'SUPER_ADMIN' && organization.lifecycle_status === 'returned' && Boolean(organization.review_remarks);
  const provisioning = viewerRole === 'SUPER_ADMIN' && organization.lifecycle_status === 'active' && hasAdministrators(organization) && Number(organization.administrators_count) === 0;
  return {
    lifecycle,
    nextStep: {
      ...nextStep,
      title: titleFor(organization, viewerRole, nextStep.title),
      body: remarksForSao ? `Your remarks: ${organization.review_remarks}` : nextStep.body,
      primary: provisioning && nextStep.primary ? { ...nextStep.primary, label: 'Add Admin account' } : nextStep.primary,
    },
  };
}

export function RegistrationStepper({ organization, viewerRole, variant = 'full', className = '' }) {
  const { lifecycle } = registrationView(organization, viewerRole);
  const steps = organization.is_university_wide ? lifecycle.steps.map((step) => step.key === 'registered' ? { ...step, label: 'College endorsement', actor: null, state: 'skipped', note: 'Not required for a unified organization' } : step) : lifecycle.steps;
  return <div className={className}><FlowStepper steps={steps} variant={variant} ariaLabel={`Registration progress for ${organization.name}`} />{variant === 'full' && <p className="mt-3 text-xs text-ink-muted-strong">{organization.is_university_wide ? 'SAO approves unified organizations directly and adds the first Admin account.' : 'After Department Head endorsement and SAO approval, the first Admin account can access the organization.'} Initial setup means adding positions, members, and the first event.</p>}</div>;
}

const LINE_TONE = {
  action: 'text-brand-700',
  waiting: 'text-warning-strong',
  blocked: 'text-danger-strong',
  done: 'text-success-strong',
};

// What a list row says about a registration: who owns the next move in words, then the compact
// stepper. The text is always present so the stage never rests on color alone.
export function RegistrationRowStatus({ organization, viewerRole, className = '' }) {
  const { nextStep } = registrationView(organization, viewerRole);
  return (
    <div className={`space-y-1.5 ${className}`}>
      <p className={`text-xs font-semibold ${LINE_TONE[nextStep.tone] ?? 'text-ink'}`}>{nextStep.title}</p>
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
