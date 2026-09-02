import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHomePage from './AdminHomePage';

const userMocks = vi.hoisted(() => ({ getUsers: vi.fn() }));
const announcementMocks = vi.hoisted(() => ({ getAnnouncements: vi.fn() }));

vi.mock('../../../services/userService', () => userMocks);
vi.mock('../../../services/announcementService', () => announcementMocks);

function pillValue(label) {
  return screen.getByText(label).parentElement?.querySelector('.tabular-nums')?.textContent;
}

describe('AdminHomePage role pills', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Regression guard for bug class (b): /users is paginated and only returns
    // ONE row on this page, far short of the org's real 214 accounts. If the
    // pills counted the loaded page instead of reading summary.by_role, every
    // pill below would render 0 or 1 instead of the true per-role total.
    userMocks.getUsers.mockResolvedValue({
      data: [{ id: 1, role: 'STUDENT' }],
      current_page: 1,
      last_page: 214,
      per_page: 1,
      total: 214,
      summary: { by_role: { STUDENT: 180, SBO_OFFICER: 20, ADMIN: 4, DEPARTMENT_HEAD: 10 } },
    });

    announcementMocks.getAnnouncements.mockImplementation((params) => {
      if (params?.published_only) {
        return Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 30 } });
      }
      return Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, per_page: 1, total: 42 } });
    });
  });

  it('reads user counts from the server total and summary.by_role, not the loaded page', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('214 total accounts')).toBeInTheDocument());
    expect(pillValue('Students')).toBe('180');
    expect(pillValue('Officers')).toBe('20');
    expect(pillValue('Admins')).toBe('4');
    expect(pillValue('Dept. Heads')).toBe('10');
  });

  it('derives published/draft announcement counts from server totals, not a loaded page', async () => {
    render(<MemoryRouter><AdminHomePage /></MemoryRouter>);

    await waitFor(() => expect(pillValue('Published Announcements')).toBe('30'));
    expect(pillValue('Draft Announcements')).toBe('12');
    expect(pillValue('Total Announcements')).toBe('42');
  });
});
