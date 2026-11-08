import { RefreshCw } from 'lucide-react';
import Button from '../ui/Button';

export default function ScannerStatus({ reader }) {
  const title = reader.scanning ? 'Waiting for a finger' : reader.connected ? 'Fingerprint reader ready' : 'Fingerprint reader not found';
  const detail = reader.mock
    ? 'Development capture mode'
    : reader.error || (reader.connected ? 'Place one finger flat and centered when prompted.' : 'Connect the reader and start HID Authentication Device Client.');
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-white p-3" role="status">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
      </div>
      {!reader.connected && (
        <Button type="button" variant="secondary" size="sm" leftIcon={RefreshCw} onClick={reader.retry} className="min-h-[42px] shrink-0">
          Try again
        </Button>
      )}
    </div>
  );
}
