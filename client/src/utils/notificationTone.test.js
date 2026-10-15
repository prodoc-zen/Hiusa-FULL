import { describe, expect, it } from 'vitest';
import { notificationAppearance, notificationTone } from './notificationTone';

describe('notification outcome colors', () => {
  it.each(['Order cancelled', 'Payment rejected', 'Compliance document returned', 'Upload failed', 'Stock alert', 'Item out of stock', 'Invoice overdue'])("marks '%s' as negative", (title) => {
    expect(notificationTone({ title })).toBe('danger');
    expect(notificationAppearance({ title }).row).toContain('bg-red-50');
  });
  it.each(['Organization approved', 'Application endorsed', 'Payment verified', 'Order claimed', 'Task completed', 'Organization restored'])("marks '%s' as positive", (title) => {
    expect(notificationTone({ title })).toBe('success');
    expect(notificationAppearance({ title }).row).toContain('bg-green-50');
  });
  it('keeps neutral updates neutral and the outcome icon visible after reading', () => {
    expect(notificationTone({ title: 'New event scheduled' })).toBe('info');
    expect(notificationAppearance({ title: 'Order cancelled', is_read: true })).toEqual({ row: 'border-transparent', icon: 'text-red-700' });
    expect(notificationTone({ title: 'Request approved', message: 'The applicant previously submitted a rejected file.' })).toBe('success');
  });
});
