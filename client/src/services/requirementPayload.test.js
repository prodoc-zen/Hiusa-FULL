import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { createRequirementType, updateRequirementType } from './complianceService';
import { createEventRequirement, updateEventRequirement } from './eventService';

vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

describe('Requirement samples are saved with their requirement', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([createRequirementType, createEventRequirement])('sends a sample file, boolean flags, and extension arrays in one multipart create', (create) => {
    const file = new File(['pdf'], 'sample.pdf', { type: 'application/pdf' });
    create({ name: 'Proposal', template: file, allowed_extensions: ['pdf', 'docx'], is_active: true, is_optional: false });
    const [, data] = api.post.mock.calls[0];
    expect(data.get('template')).toBe(file);
    expect(data.getAll('allowed_extensions[]')).toEqual(['pdf', 'docx']);
    expect(data.get('is_active')).toBe('1');
    expect(data.get('is_optional')).toBe('0');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it.each([updateRequirementType, updateEventRequirement])('uses multipart POST with method override to update an attached sample', (update) => {
    const file = new File(['pdf'], 'sample.pdf', { type: 'application/pdf' });
    update(9, { name: 'Proposal', template: file });
    expect(api.post.mock.calls[0][1].get('_method')).toBe('PUT');
    expect(api.post.mock.calls[0][1].get('template')).toBe(file);
    expect(api.put).not.toHaveBeenCalled();
  });

  it.each([createRequirementType, createEventRequirement])('keeps sample links in the create payload', (create) => {
    const payload = { name: 'Proposal', template_url: 'https://example.edu/sample' };
    create(payload);
    expect(api.post.mock.calls[0][1]).toEqual(payload);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
