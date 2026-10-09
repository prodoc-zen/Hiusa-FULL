import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { openProtectedFile } from './openProtectedFile';

vi.mock('../services/api', () => ({ default: { get: vi.fn() } }));

describe('openProtectedFile', () => {
  let tab;

  beforeEach(() => {
    vi.clearAllMocks();
    tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab);
    URL.createObjectURL = vi.fn(() => 'blob:file');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it('fetches the file with the bearer token as a blob and shows it in the opened tab', async () => {
    api.get.mockResolvedValue({ data: new Blob(['pdf']) });

    await openProtectedFile('/compliance/submissions/5/document');

    expect(api.get).toHaveBeenCalledWith('/compliance/submissions/5/document', { responseType: 'blob' });
    expect(tab.location.href).toBe('blob:file');
  });

  it('closes the blank tab and rethrows when the file cannot be fetched', async () => {
    api.get.mockRejectedValue(new Error('404'));

    await expect(openProtectedFile('/financial-reports/1/documents/9')).rejects.toThrow('404');
    expect(tab.close).toHaveBeenCalled();
  });

  it('tells the person to allow pop-ups instead of failing silently', async () => {
    window.open.mockReturnValue(null);

    await expect(openProtectedFile('/x')).rejects.toMatchObject({ userMessage: 'Allow pop-ups to open this file.' });
    expect(api.get).not.toHaveBeenCalled();
  });
});
