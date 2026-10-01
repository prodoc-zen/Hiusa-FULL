import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '../../../components/ui';

export const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const LIMITS_LABEL = 'PDF, JPG, PNG, DOC, DOCX, XLS or XLSX, up to 10 MB';

export function validateComplianceFile(file) {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
  const typeOk = ACCEPTED_MIME_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(extension);
  if (!typeOk) return "This file type isn't accepted. Use PDF, JPG, PNG, DOC, DOCX, XLS or XLSX.";
  if (file.size > MAX_FILE_SIZE_BYTES) return 'This file is larger than 10 MB. Choose a smaller file.';
  return null;
}

export default function ComplianceDropzone({ onFileSelected, disabled, error }) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  function handleFiles(fileList) {
    const file = fileList?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <div>
      <div
        role="presentation"
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (!disabled) handleFiles(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-2 rounded-card border-2 border-dashed p-6 text-center transition-colors duration-150 ${dragActive ? 'border-brand-600 bg-brand-50' : 'border-line bg-subtle'} ${disabled ? 'opacity-50' : ''}`}
      >
        <UploadCloud size={28} className="text-brand-600" aria-hidden="true" />
        <p className="text-sm font-semibold text-ink">Drag a file here, or</p>
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          disabled={disabled}
          className="sr-only"
          aria-label="Upload compliance document"
          onChange={(event) => { handleFiles(event.target.files); event.target.value = ''; }}
        />
        <p className="text-xs font-medium text-ink-muted">{LIMITS_LABEL}</p>
      </div>
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}
