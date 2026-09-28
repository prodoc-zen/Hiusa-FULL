import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmModal from './ConfirmModal';

describe('ConfirmModal', () => {
  it('names the action through confirmText instead of generic boilerplate copy', () => {
    render(
      <ConfirmModal
        open
        title="Delete this event?"
        message="Its tasks and attendance records will be removed."
        recordName="General Assembly"
        confirmText="Delete event"
        variant="danger"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete event' })).toBeInTheDocument();
    expect(screen.queryByText(/This action may be irreversible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Please confirm this action before continuing/i)).not.toBeInTheDocument();
  });

  it('shows a loading confirm button and disables cancel while busy', () => {
    render(
      <ConfirmModal
        open
        title="Delete this event?"
        message="Its tasks and attendance records will be removed."
        confirmText="Delete event"
        busy
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete event' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('confirms and cancels through the kit Button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        open
        title="Log out?"
        message="You will need to sign in again to access your dashboard."
        confirmText="Log Out"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    screen.getByRole('button', { name: 'Log Out' }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Cancel' }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('requires the named confirmation before a destructive action', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open
        title="Delete product?"
        message="This will hide the product."
        recordName="HIUSA Shirt"
        confirmationText="HIUSA Shirt"
        confirmText="Delete product"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Delete product' });
    expect(confirm).toBeDisabled();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'HIUSA Shirt' } });
    expect(confirm).toBeEnabled();
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
