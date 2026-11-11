import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FingerprintEnrollmentModal, UserActionDock } from './AdminUsersPage';

const fingerprintMocks = vi.hoisted(() => ({
  enrollFingerprint: vi.fn(),
  identifyFingerprint: vi.fn(),
  removeFingerprint: vi.fn(),
  reader: {
    connected: true,
    scanning: false,
    mock: false,
    error: null,
    retry: vi.fn(),
    enrollFingerprint: vi.fn(),
    identifyFingerprint: vi.fn(),
    cancelCapture: vi.fn(),
  },
}));

vi.mock('../../../services/fingerprintService', () => ({
  enrollFingerprint: fingerprintMocks.enrollFingerprint,
  identifyFingerprint: fingerprintMocks.identifyFingerprint,
  removeFingerprint: fingerprintMocks.removeFingerprint,
}));

vi.mock('../../../hooks/useFingerprintReader', () => ({
  useFingerprintReader: () => fingerprintMocks.reader,
}));

describe('UserActionDock', () => {
  it('lets managers open organization membership and hides it from officers', () => {
    const onAddProfile = vi.fn();
    const user = { school_id: 123, first_name: 'Ana', last_name: 'Reyes', role: 'STUDENT', account_status: 'active' };
    const view = render(<UserActionDock user={user} actorRole="ADMIN" onAddProfile={onAddProfile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Ana Reyes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Ana Reyes to an organization' }));
    expect(onAddProfile).toHaveBeenCalledOnce();
    view.rerender(<UserActionDock user={user} actorRole="SBO_OFFICER" onAddProfile={onAddProfile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Ana Reyes' }));
    expect(screen.queryByRole('menuitem', { name: 'Add Ana Reyes to an organization' })).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    fingerprintMocks.reader.enrollFingerprint.mockResolvedValue({ samples: ['one', 'two', 'three', 'four'], sampleFormat: 5 });
    fingerprintMocks.enrollFingerprint.mockResolvedValue({ data: { message: 'Enrolled' } });
    fingerprintMocks.removeFingerprint.mockResolvedValue({ data: { message: 'Removed' } });
  });

  it('lets an organization Admin verify an Adviser without exposing SAO-managed controls', () => {
    const onFingerprint = vi.fn();
    const onVerify = vi.fn();
    const user = {
      school_id: 990002,
      first_name: 'Organization',
      last_name: 'Adviser',
      role: 'ADMIN',
      account_status: 'active',
      fingerprint_enrolled: false,
    };

    render(
      <UserActionDock
        user={user}
        actorRole="ADMIN"
        onEdit={vi.fn()}
        onView={vi.fn()}
        onFingerprint={onFingerprint}
        onVerify={onVerify}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Open actions for Organization Adviser' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Close actions for Organization Adviser' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open actions for Organization Adviser' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Organization Adviser' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Enroll fingerprint for Organization Adviser' }));
    expect(onFingerprint).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Organization Adviser' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Verify identity for Organization Adviser' }));
    expect(onVerify).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem', { name: 'Edit Organization Adviser' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate Organization Adviser' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete Organization Adviser' })).not.toBeInTheDocument();
  });

  it('allows an SBO Officer to manage Student biometrics without account controls', () => {
    const student = {
      school_id: 2400019,
      first_name: 'Trisha',
      last_name: 'Herrera',
      role: 'STUDENT',
      account_status: 'active',
      fingerprint_enrolled: false,
    };

    render(
      <UserActionDock
        user={student}
        actorRole="SBO_OFFICER"
        onEdit={vi.fn()}
        onView={vi.fn()}
        onFingerprint={vi.fn()}
        onVerify={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Trisha Herrera' }));
    expect(screen.getByRole('menuitem', { name: 'Enroll fingerprint for Trisha Herrera' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit Trisha Herrera' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate Trisha Herrera' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete Trisha Herrera' })).not.toBeInTheDocument();
  });

  it('keeps another SBO Officer read-only to an SBO Officer', () => {
    const officer = {
      school_id: 900004,
      first_name: 'Diego',
      last_name: 'Villanueva',
      role: 'SBO_OFFICER',
      account_status: 'active',
      fingerprint_enrolled: true,
    };

    render(
      <UserActionDock
        user={officer}
        actorRole="SBO_OFFICER"
        onEdit={vi.fn()}
        onView={vi.fn()}
        onFingerprint={vi.fn()}
        onVerify={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Diego Villanueva' }));
    expect(screen.getByRole('menuitem', { name: 'View Diego Villanueva' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Verify identity for Diego Villanueva' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit Diego Villanueva' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Re-enroll fingerprint for Diego Villanueva' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate Diego Villanueva' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete Diego Villanueva' })).not.toBeInTheDocument();
  });

  it('uses dedicated modals for fingerprint enrollment and removal confirmation', async () => {
    const student = {
      school_id: 2400019,
      first_name: 'Trisha',
      last_name: 'Herrera',
      role: 'STUDENT',
      fingerprint_enrolled: false,
    };
    const onSaved = vi.fn();
    const firstRender = render(<FingerprintEnrollmentModal user={student} onClose={vi.fn()} onSaved={onSaved} />);

    expect(screen.getByRole('dialog', { name: 'Enroll fingerprint' })).toBeInTheDocument();
    const startButton = screen.getByRole('button', { name: 'Start 4-scan enrollment' });
    expect(startButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(startButton).toBeEnabled();
    fireEvent.click(startButton);

    await waitFor(() => expect(fingerprintMocks.reader.enrollFingerprint).toHaveBeenCalledWith(4, expect.any(Function)));
    expect(fingerprintMocks.enrollFingerprint).toHaveBeenCalledWith(2400019, { samples: ['one', 'two', 'three', 'four'], sampleFormat: 5 });
    firstRender.unmount();

    render(<FingerprintEnrollmentModal user={{ ...student, fingerprint_enrolled: true }} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByRole('dialog', { name: 'Re-enroll fingerprint' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('dialog', { name: 'Remove fingerprint enrollment' })).toBeInTheDocument();
    expect(fingerprintMocks.removeFingerprint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove fingerprint' }));
    await waitFor(() => expect(fingerprintMocks.removeFingerprint).toHaveBeenCalledWith(2400019));
  });
});

describe('UserActionDock offers only what the server will do', () => {
  const open = (user, props = {}) => {
    render(<UserActionDock user={{ account_status: 'active', first_name: 'Row', last_name: 'Person', ...user }} actorRole="ADMIN" actorSchoolId={900001} onEdit={vi.fn()} onView={vi.fn()} onDeactivate={vi.fn()} onReactivate={vi.fn()} onDelete={vi.fn()} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Row Person' }));
  };
  const has = (name) => screen.queryByRole('menuitem', { name }) !== null;

  it('offers no deactivate or delete on the actor own row, but keeps edit', () => {
    open({ school_id: 900001, role: 'ADMIN', position_title: 'President' });
    expect(has('Edit Row Person')).toBe(true);
    expect(has('Deactivate Row Person')).toBe(false);
    expect(has('Delete Row Person')).toBe(false);
  });

  it('offers no deactivate, reactivate or delete on another administrator', () => {
    open({ school_id: 900002, role: 'ADMIN', position_title: 'Vice President', account_status: 'disabled' });
    expect(has('Edit Row Person')).toBe(true);
    expect(has('Deactivate Row Person')).toBe(false);
    expect(has('Reactivate Row Person')).toBe(false);
    expect(has('Delete Row Person')).toBe(false);
  });

  it('offers no edit, deactivate or delete on the Adviser', () => {
    open({ school_id: 990002, role: 'ADMIN', position_title: 'Adviser' });
    expect(has('View Row Person')).toBe(true);
    expect(has('Edit Row Person')).toBe(false);
    expect(has('Deactivate Row Person')).toBe(false);
    expect(has('Delete Row Person')).toBe(false);
  });

  it('offers no account actions on a department head, whom only the SAO manages', () => {
    open({ school_id: 800001, role: 'DEPARTMENT_HEAD' });
    expect(has('View Row Person')).toBe(true);
    expect(has('Edit Row Person')).toBe(false);
    expect(has('Deactivate Row Person')).toBe(false);
    expect(has('Delete Row Person')).toBe(false);
  });

  it('still offers every account action on a student', () => {
    open({ school_id: 2400019, role: 'STUDENT' });
    expect(has('Edit Row Person')).toBe(true);
    expect(has('Deactivate Row Person')).toBe(true);
    expect(has('Delete Row Person')).toBe(true);
  });
});
