import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Drawer from './Drawer';

describe('Drawer', () => {
  it('portals the backdrop and the panel together so nothing in the app tree covers the panel', () => {
    const { container } = render(<Drawer open title="Import members" onClose={vi.fn()}><button type="button">Inside</button></Drawer>);

    const dialog = screen.getByRole('dialog', { name: 'Import members' });
    expect(container).toBeEmptyDOMElement();
    expect(dialog).toHaveClass('app-overlay', 'fixed', 'inset-0');
    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Inside' }));
  });

  it('closes on a backdrop press but not on a press inside the panel', () => {
    const onClose = vi.fn();
    render(<Drawer open title="Import members" onClose={onClose}><p>Body</p></Drawer>);

    fireEvent.mouseDown(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
