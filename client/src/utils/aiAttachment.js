export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// An accept list only: no capture attribute, so a phone offers the camera and the files without forcing either.
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(',');

// The same rules the server enforces (mimes and max:5120); this only saves a round trip.
export function attachmentError(file) {
  if (!file) return '';
  if (!ATTACHMENT_TYPES.includes(file.type)) return 'Attach a JPG, PNG, WebP or PDF file.';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'That file is over 5 MB. Choose a smaller one.';
  if (file.size === 0) return 'That file is empty.';
  return '';
}
