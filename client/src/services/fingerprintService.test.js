import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./api', () => ({ default: api }));

import { confirmFingerprintAttendance, enrollFingerprint, identifyAttendanceFingerprint, identifyFingerprint, removeFingerprint } from './fingerprintService';

describe('fingerprint API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the HIUSA school ID and records enrollment consent', () => {
    const capture = { samples: ['one', 'two', 'three', 'four'], sampleFormat: 5 };

    enrollFingerprint(20260001, capture);
    removeFingerprint(20260001);

    expect(api.post).toHaveBeenCalledWith('/users/20260001/fingerprint', {
      samples: capture.samples,
      sample_format: 5,
      finger_index: 0,
      consent_confirmed: true,
    });
    expect(api.delete).toHaveBeenCalledWith('/users/20260001/fingerprint');
  });

  it('separates attendance identification from operator confirmation', () => {
    const capture = { samples: ['single-probe'], sampleFormat: 5 };

    identifyFingerprint(capture);
    identifyAttendanceFingerprint(44, capture, { year_levels: ['4th Year'], programs: ['BSIT'] });
    confirmFingerprintAttendance(44, 'signed-confirmation');

    expect(api.post).toHaveBeenNthCalledWith(1, '/fingerprints/identify', {
      samples: ['single-probe'],
      sample_format: 5,
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/events/44/attendance/fingerprint', {
      samples: ['single-probe'],
      sample_format: 5,
      year_levels: ['4th Year'],
      programs: ['BSIT'],
    });
    expect(api.post).toHaveBeenNthCalledWith(3, '/events/44/attendance/fingerprint/confirm', {
      confirmation_token: 'signed-confirmation',
    });
  });
});
