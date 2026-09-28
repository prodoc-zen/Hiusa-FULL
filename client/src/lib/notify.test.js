import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), promise: vi.fn() }),
}));

import { toast } from 'sonner';
import notify from './notify';

describe('notify', () => {
  it('delegates success to sonner toast.success', () => {
    notify.success('Saved', { duration: 1000 });
    expect(toast.success).toHaveBeenCalledWith('Saved', { duration: 1000 });
  });

  it('delegates error to sonner toast.error', () => {
    notify.error('Failed');
    expect(toast.error).toHaveBeenCalledWith('Failed', undefined);
  });

  it('delegates info to sonner toast.info so its icon renders', () => {
    notify.info('Heads up');
    expect(toast.info).toHaveBeenCalledWith('Heads up', undefined);
    expect(toast).not.toHaveBeenCalled();
  });

  it('delegates warning to sonner toast.warning', () => {
    notify.warning('Check the amount');
    expect(toast.warning).toHaveBeenCalledWith('Check the amount', undefined);
  });

  it('delegates promise to sonner toast.promise', () => {
    const pending = Promise.resolve();
    const options = { loading: 'Working', success: 'Done', error: 'Oops' };
    notify.promise(pending, options);
    expect(toast.promise).toHaveBeenCalledWith(pending, options);
  });
});
