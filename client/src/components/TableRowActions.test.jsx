import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TableRowActions from './TableRowActions';

describe('TableRowActions', () => {
  it('opens from a clipped table, supports keyboard navigation, and runs the chosen action', () => {
    const onReview = vi.fn();
    const onReject = vi.fn();
    render(<div className="overflow-x-auto"><table><tbody><tr><td>
      <TableRowActions subject="Order 12" label="Order actions" actions={[
        { label: 'Review order', onClick: onReview },
        { label: 'Reject order', danger: true, onClick: onReject },
      ]} />
    </td></tr></tbody></table></div>);

    const trigger = screen.getByRole('button', { name: 'Actions for Order 12' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Order actions for Order 12' }).parentElement).toBe(document.body);
    expect(screen.getByRole('menuitem', { name: 'Review order' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Reject order' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review order' }));
    expect(onReview).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  describe('scrolling and touch size', () => {
    const rectAt = (top) => ({ top, bottom: top + 44, left: 500, right: 544, width: 44, height: 44 });
    const renderOpen = (top) => {
      render(<TableRowActions subject="Order 12" actions={[{ label: 'Review order', onClick: vi.fn() }]} />);
      const trigger = screen.getByRole('button', { name: 'Actions for Order 12' });
      let rect = rectAt(top);
      trigger.getBoundingClientRect = () => rect;
      fireEvent.click(trigger);
      return { trigger, moveTo: (nextTop) => { rect = rectAt(nextTop); } };
    };

    it('is 44px high and wide on touch screens and 40px from the md breakpoint', () => {
      render(<TableRowActions subject="Order 12" actions={[{ label: 'Review order', onClick: vi.fn() }]} />);
      const trigger = screen.getByRole('button', { name: 'Actions for Order 12' });

      expect(trigger).toHaveClass('h-11', 'w-11', 'md:h-10', 'md:w-10');
      expect(trigger).not.toHaveClass('h-10');
    });

    it('stays open and follows its trigger while the page scrolls', () => {
      const { moveTo } = renderOpen(200);
      const menu = screen.getByRole('menu');
      expect(menu.style.top).toBe('252px');

      moveTo(150);
      fireEvent.scroll(window);

      expect(screen.getByRole('menu')).toBe(menu);
      expect(menu.style.top).toBe('202px');
    });

    it('keeps its own scrolling from closing or moving it', () => {
      renderOpen(200);
      const menu = screen.getByRole('menu');

      fireEvent.scroll(menu);

      expect(screen.getByRole('menu')).toBe(menu);
      expect(menu.style.top).toBe('252px');
    });

    it('closes once the trigger has scrolled out of view', () => {
      const { moveTo } = renderOpen(200);

      moveTo(window.innerHeight + 40);
      fireEvent.scroll(window);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes when the trigger scrolls under the navbar', () => {
      document.documentElement.style.setProperty('--dashboard-navbar-bottom', '92px');
      const { moveTo } = renderOpen(300);

      moveTo(20);
      fireEvent.scroll(window);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      document.documentElement.style.removeProperty('--dashboard-navbar-bottom');
    });

    it('still closes on an outside press', () => {
      renderOpen(200);

      fireEvent.pointerDown(document.body);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('keeps the portaled menu below the navbar', () => {
    document.documentElement.style.setProperty('--dashboard-navbar-bottom', '92px');
    document.documentElement.style.setProperty('--dashboard-sidebar-width', '260px');
    render(<TableRowActions subject="Order 12" actions={[{ label: 'Review order', onClick: vi.fn() }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Order 12' }));
    expect(screen.getByRole('menu').style.top).toBe('100px');
    expect(screen.getByRole('menu').style.left).toBe('272px');

    document.documentElement.style.removeProperty('--dashboard-navbar-bottom');
    document.documentElement.style.removeProperty('--dashboard-sidebar-width');
  });
});
