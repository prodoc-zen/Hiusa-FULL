import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), promise: vi.fn() }),
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

  it('delegates info to the base sonner toast call', () => {
    notify.info('Heads up');
    expect(toast).toHaveBeenCalledWith('Heads up', undefined);
  });

  it('delegates promise to sonner toast.promise', () => {
    const pending = Promise.resolve();
    const options = { loading: 'Working', success: 'Done', error: 'Oops' };
    notify.promise(pending, options);
    expect(toast.promise).toHaveBeenCalledWith(pending, options);
  });
});
