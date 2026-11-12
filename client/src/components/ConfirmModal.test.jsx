import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(screen.getByRole('dialog', { name: 'Delete this event?' }).parentElement).toHaveClass('app-overlay');
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

  it('keeps the dialog open and announces a server error inside it', () => {
    render(
      <ConfirmModal
        open
        title="Delete this budget?"
        message="This cannot be undone."
        recordName="Q1 Budget"
        confirmText="Delete budget"
        error="This budget has transactions."
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete this budget?' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This budget has transactions.');
  });

  it('lays a danger confirmation out as a centered stack: title, one consequence line, name, Delete then Cancel', () => {
    render(
      <ConfirmModal
        open
        title="Delete this event?"
        message="Its tasks and attendance records will be removed."
        recordName="General Assembly"
        confirmText="Delete event"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete this event?' });
    expect(dialog).toHaveAttribute('data-layout', 'centered');
    expect(within(dialog).getByRole('heading', { name: 'Delete this event?' })).toHaveClass('text-danger-strong', 'text-center');
    expect(within(dialog).getByText('Its tasks and attendance records will be removed.')).toHaveClass('text-center');
    expect(within(dialog).getByText('General Assembly')).toHaveClass('font-semibold', 'text-center');
    expect(within(dialog).getByRole('button', { name: 'Close modal' })).toBeInTheDocument();
    const buttons = within(dialog).getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== 'Close modal');
    expect(buttons.map((button) => button.textContent)).toEqual(['Delete event', 'Cancel']);
    expect(buttons[0]).toHaveAttribute('data-variant', 'danger');
    expect(buttons[1]).toHaveAttribute('data-variant', 'secondary');
    expect(Array.from(dialog.querySelectorAll('img, svg')).filter((node) => !node.closest('button'))).toHaveLength(0);
  });

  it('puts keyboard focus on Cancel, not on the destructive button', () => {
    render(
      <ConfirmModal open title="Delete this event?" message="Gone for good." confirmText="Delete event" onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('keeps the standard layout for a primary confirmation such as signing out', () => {
    render(
      <ConfirmModal open variant="primary" title="Log out?" message="You will need to sign in again." confirmText="Log Out" onCancel={() => {}} onConfirm={() => {}} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Log out?' });
    expect(dialog).not.toHaveAttribute('data-layout');
    expect(within(dialog).getByRole('heading', { name: 'Log out?' })).not.toHaveClass('text-danger-strong');
    const buttons = within(dialog).getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== 'Close modal');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Log Out']);
  });

  it('shows the message as the single body line when no record name is given', () => {
    render(
      <ConfirmModal open title="Remove this draft?" message="The draft will be removed." confirmText="Remove" onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getAllByText('The draft will be removed.')).toHaveLength(1);
  });

  it('does not offer the corner close while busy', () => {
    render(
      <ConfirmModal open busy title="Delete this event?" message="Gone." confirmText="Delete event" onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Close modal' })).not.toBeInTheDocument();
  });
});
