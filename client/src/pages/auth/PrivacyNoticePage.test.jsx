import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PrivacyNoticePage from './PrivacyNoticePage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/privacy']}>
      <PrivacyNoticePage />
    </MemoryRouter>,
  );
}

describe('PrivacyNoticePage', () => {
  it('names the law and the version, and the Student Affairs Office as the contact', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Data Privacy Notice' })).toBeInTheDocument();
    expect(screen.getByText(/Version 2026-11/)).toBeInTheDocument();
    expect(screen.getByText(/Republic Act No\. 10173, the Data Privacy Act of 2012/)).toBeInTheDocument();
    const contact = screen.getByRole('region', { name: 'Who to contact' });
    expect(within(contact).getByText(/Student Affairs Office/)).toBeInTheDocument();
  });

  it('covers what is collected, why, who sees it, how long and the rights', () => {
    renderPage();

    ['Who handles your data', 'What the system collects', 'Why we collect it', 'Who can see it', 'How long we keep it', 'Your rights', 'Who to contact'].forEach((name) => {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    });
    const collected = screen.getByRole('region', { name: 'What the system collects' });
    expect(within(collected).getByText(/Fingerprint templates/)).toBeInTheDocument();
    expect(within(collected).getByText(/Grievances you file/)).toBeInTheDocument();
    expect(within(collected).getByText(/Finance records/)).toBeInTheDocument();
  });

  it('opens without signing in and offers a way to sign in', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('gives the back to sign in link a hit area of at least 42px', () => {
    renderPage();

    const link = screen.getByRole('link', { name: 'Back to sign in' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveClass('inline-flex', 'items-center', 'min-h-[42px]');
  });

  it('uses no em dash or en dash', () => {
    const { container } = renderPage();

    expect(container.textContent).not.toMatch(/[–—]/);
  });
});
