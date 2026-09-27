import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/notify', () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), promise: vi.fn() },
}));

import notify from '../lib/notify';
import FeedbackToast from './FeedbackToast';

describe('FeedbackToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates an open success feedback to notify.success', () => {
    render(<FeedbackToast feedback={{ open: true, type: 'success', message: 'Saved changes' }} onClose={() => {}} />);
    expect(notify.success).toHaveBeenCalledWith('Saved changes', expect.objectContaining({ duration: 3600 }));
  });

  it('delegates an error feedback to notify.error and unknown types to notify.info', () => {
    const { rerender } = render(<FeedbackToast feedback={{ open: true, type: 'error', message: 'It broke' }} onClose={() => {}} />);
    expect(notify.error).toHaveBeenCalledWith('It broke', expect.anything());

    rerender(<FeedbackToast feedback={{ open: true, type: 'notice', message: 'FYI' }} onClose={() => {}} />);
    expect(notify.info).toHaveBeenCalledWith('FYI', expect.anything());
  });

  it('does not refire for the same still-open feedback', () => {
    const { rerender } = render(<FeedbackToast feedback={{ open: true, type: 'success', message: 'Once' }} onClose={() => {}} />);
    expect(notify.success).toHaveBeenCalledTimes(1);

    rerender(<FeedbackToast feedback={{ open: true, type: 'success', message: 'Once' }} onClose={() => {}} />);
    expect(notify.success).toHaveBeenCalledTimes(1);
  });

  it('renders nothing itself', () => {
    const { container } = render(<FeedbackToast feedback={{ open: false, message: '' }} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
