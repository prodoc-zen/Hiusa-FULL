import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../services/api';
import TopBar from './TopBar';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  getAccountProfiles: vi.fn(),
  switchAccountProfile: vi.fn(),
}));
const periodMocks = vi.hoisted(() => ({
  getActiveAcademicPeriod: vi.fn(),
  getAcademicPeriods: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/authService', () => authMocks);
vi.mock('../../services/systemAdministrationService', () => periodMocks);

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function serve(rows) {
  const patches = [];
  api.defaults.adapter = async (config) => {
    const url = String(config.url);
    const done = (data) => ({ status: 200, data, headers: {}, config, statusText: 'OK' });
    if (config.method === 'get' && url === '/notifications') {
      return done({ data: rows.map((row) => ({ ...row })), current_page: 1, last_page: 1, unread_count: rows.filter((row) => !row.is_read).length });
    }
    if (config.method === 'patch' && url === '/notifications/read-all') {
      patches.push('all');
      rows.forEach((row) => { row.is_read = true; });
      return done({ message: 'ok' });
    }
    const single = url.match(/^\/notifications\/(\d+)\/read$/);
    if (config.method === 'patch' && single) {
      patches.push(Number(single[1]));
      rows.find((row) => row.id === Number(single[1])).is_read = true;
      return done({});
    }
    return done({});
  };
  return patches;
}

const row = (id, extra = {}) => ({ id, title: `Notice ${id}`, message: `Body ${id}`, is_read: false, created_at: '2026-11-01T00:00:00Z', notification_type: 'announcement', reference_type: 'announcement', reference_id: id, ...extra });

describe('TopBar notification reading through the real api layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    periodMocks.getActiveAcademicPeriod.mockResolvedValue({ number: 2, academic_year: { label: '2026-2027' } });
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [{ id: 1, role: 'STUDENT', account_status: 'active', organization: { id: 1, name: 'Main Campus', acronym: 'MC', is_active: true } }] } });
  });

  for (const role of ['STUDENT', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'SUPER_ADMIN']) {
    it(`${role}: clicking a notification marks it read, drops the badge and opens its target`, async () => {
      localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
      const patches = serve([row(1), row(2)]);
      render(<MemoryRouter><TopBar onMenuToggle={() => {}} /><Where /></MemoryRouter>);
      const bell = await screen.findByRole('button', { name: 'Notifications' });
      await waitFor(() => expect(within(bell).getByText('2')).toBeInTheDocument());

      fireEvent.click(bell);
      const panel = await screen.findByRole('region', { name: 'Notifications panel' });
      fireEvent.click(await within(panel).findByRole('button', { name: /Notice 1/ }));

      await waitFor(() => expect(patches).toEqual([1]));
      await waitFor(() => expect(within(bell).getByText('1')).toBeInTheDocument());
      expect(within(bell).queryByText('2')).not.toBeInTheDocument();
      expect(screen.getByTestId('where').textContent).toMatch(/announcements/);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(within(bell).getByText('1')).toBeInTheDocument();
    });
  }

  it('Mark all as read clears the badge', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Test', last_name: 'User' }));
    serve([row(1), row(2)]);
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(within(bell).getByText('2')).toBeInTheDocument());
    fireEvent.click(bell);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(within(bell).queryByText('2')).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bell.querySelector('span')).toBeNull();
  });
});

describe('TopBar notification reading on a slow connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    periodMocks.getActiveAcademicPeriod.mockResolvedValue({ number: 2, academic_year: { label: '2026-2027' } });
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [{ id: 1, role: 'STUDENT', account_status: 'active', organization: { id: 1, name: 'Main Campus', acronym: 'MC', is_active: true } }] } });
  });

  function serveSlowWrites(rows) {
    const held = [];
    serve(rows);
    const reads = api.defaults.adapter;
    api.defaults.adapter = (config) => (config.method === 'patch'
      ? new Promise((resolve, reject) => held.push(() => reads(config).then(resolve, reject)))
      : reads(config));
    return { held };
  }

  for (const role of ['STUDENT', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'SUPER_ADMIN']) {
    it(`${role}: the badge drops and the target opens before the server answers`, async () => {
      localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
      const { held } = serveSlowWrites([row(1), row(2)]);
      render(<MemoryRouter><TopBar onMenuToggle={() => {}} /><Where /></MemoryRouter>);
      const bell = await screen.findByRole('button', { name: 'Notifications' });
      await waitFor(() => expect(within(bell).getByText('2')).toBeInTheDocument());

      fireEvent.click(bell);
      const panel = await screen.findByRole('region', { name: 'Notifications panel' });
      fireEvent.click(await within(panel).findByRole('button', { name: /Notice 1/ }));

      await waitFor(() => expect(within(bell).getByText('1')).toBeInTheDocument());
      expect(screen.getByTestId('where').textContent).toMatch(/announcements/);
      expect(held).toHaveLength(1);
    });
  }

  it('Mark all as read clears the badge before the server answers', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Test', last_name: 'User' }));
    serveSlowWrites([row(1), row(2)]);
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(within(bell).getByText('2')).toBeInTheDocument());
    fireEvent.click(bell);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(within(bell).queryByText('2')).not.toBeInTheDocument());
  });

  it('puts the unread state back when the server refuses the read', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Test', last_name: 'User' }));
    const rows = [row(1), row(2)];
    serve(rows);
    const reads = api.defaults.adapter;
    api.defaults.adapter = (config) => (config.method === 'patch' ? Promise.reject(Object.assign(new Error('boom'), { config, response: { status: 500, data: {} } })) : reads(config));
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(within(bell).getByText('2')).toBeInTheDocument());
    fireEvent.click(bell);
    const panel = await screen.findByRole('region', { name: 'Notifications panel' });
    fireEvent.click(await within(panel).findByRole('button', { name: /Notice 1/ }));

    await waitFor(() => expect(within(bell).getByText('2')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(within(bell).getByText('2')).toBeInTheDocument();
  });
});
