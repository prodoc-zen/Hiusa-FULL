import { describe, expect, it } from 'vitest';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, attachmentError } from './aiAttachment';

const file = (name, type, size = 1000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('attachmentError', () => {
  it('accepts jpeg, png, webp and pdf up to 5 MB', () => {
    ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].forEach((type) => {
      expect(attachmentError(file('a', type))).toBe('');
    });
    expect(attachmentError(file('big.pdf', 'application/pdf', ATTACHMENT_MAX_BYTES))).toBe('');
  });

  it('refuses another type with a plain sentence', () => {
    expect(attachmentError(file('a.gif', 'image/gif'))).toBe('Attach a JPG, PNG, WebP or PDF file.');
    expect(attachmentError(file('a.docx', ''))).toBe('Attach a JPG, PNG, WebP or PDF file.');
  });

  it('refuses a file over 5 MB', () => {
    expect(attachmentError(file('big.png', 'image/png', ATTACHMENT_MAX_BYTES + 1))).toBe('That file is over 5 MB. Choose a smaller one.');
  });

  it('refuses an empty file', () => {
    expect(attachmentError(file('empty.png', 'image/png', 0))).toBe('That file is empty.');
  });

  it('lists the accepted types without forcing the camera', () => {
    expect(ATTACHMENT_ACCEPT).toBe('image/jpeg,image/png,image/webp,application/pdf');
  });
});
