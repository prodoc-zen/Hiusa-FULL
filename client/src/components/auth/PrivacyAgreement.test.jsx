import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PrivacyAgreement from './PrivacyAgreement';

function renderAgreement(props = {}) {
  return render(
    <MemoryRouter>
      <PrivacyAgreement id="agree" checked={false} onChange={() => {}} {...props} />
    </MemoryRouter>,
  );
}

describe('PrivacyAgreement', () => {
  it('opens the Data Privacy Notice in a new tab from the sentence', () => {
    renderAgreement();

    const link = screen.getByRole('link', { name: 'Data Privacy Notice' });
    expect(link).toHaveAttribute('href', '/privacy');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('gives the notice link a hit area of at least 42px without moving the sentence', () => {
    renderAgreement();

    // Block padding on an inline link makes it taller to tap and leaves the line it sits on exactly as tall as before.
    const link = screen.getByRole('link', { name: 'Data Privacy Notice' });
    expect(link).toHaveClass('py-3');
    expect(link).not.toHaveClass('block', 'inline-block', 'inline-flex');
  });

  it('reports the tick', () => {
    const onChange = vi.fn();
    renderAgreement({ onChange });

    fireEvent.click(screen.getByLabelText(/agree to the processing of my personal data/));

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
