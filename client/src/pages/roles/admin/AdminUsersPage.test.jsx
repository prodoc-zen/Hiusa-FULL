import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserActionDock } from './AdminUsersPage';

describe('UserActionDock', () => {
  it('expands Admin actions and exposes fingerprint enrollment without destructive controls', () => {
    const onFingerprint = vi.fn();
    const onVerify = vi.fn();
    const user = {
      school_id: 910001,
      first_name: 'Ricardo',
      last_name: 'Lim',
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

    const trigger = screen.getByRole('button', { name: 'Open actions for Ricardo Lim' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Close actions for Ricardo Lim' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open actions for Ricardo Lim' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Ricardo Lim' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Enroll fingerprint for Ricardo Lim' }));
    expect(onFingerprint).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Ricardo Lim' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Verify identity for Ricardo Lim' }));
    expect(onVerify).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate Ricardo Lim' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete Ricardo Lim' })).not.toBeInTheDocument();
  });
});
