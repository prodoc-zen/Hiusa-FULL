export const SUPPORTED_REQUIREMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'];

export function acceptedExtensions(extensions) {
  return Array.isArray(extensions) && extensions.length ? extensions : SUPPORTED_REQUIREMENT_EXTENSIONS;
}

export function fileTypesLabel(extensions) {
  return acceptedExtensions(extensions).map((extension) => extension.toUpperCase()).join(', ');
}

export function fileAccept(extensions) {
  return acceptedExtensions(extensions).map((extension) => `.${extension}`).join(',');
}

export function validateRequirementFile(file, extensions) {
  const allowed = acceptedExtensions(extensions);
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!allowed.includes(extension)) return `Accepted file types: ${fileTypesLabel(allowed)}.`;
  if (file.size > 10 * 1024 * 1024) return 'This file is larger than 10 MB. Choose a smaller file.';
  return null;
}
