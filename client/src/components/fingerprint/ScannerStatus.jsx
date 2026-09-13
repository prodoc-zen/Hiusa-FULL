import { Fingerprint, RefreshCw, Usb } from 'lucide-react';

export default function ScannerStatus({ reader }) {
  const tone = reader.connected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${tone}`} role="status">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/80">
        {reader.scanning ? <Fingerprint className="animate-pulse" size={20} /> : <Usb size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">{reader.scanning ? 'Waiting for finger...' : reader.connected ? 'DigitalPersona reader ready' : 'Reader unavailable'}</p>
        <p className="mt-0.5 text-xs font-medium opacity-80">{reader.mock ? 'Development capture mode' : reader.error || (reader.connected ? 'Place one finger flat and centered when prompted.' : 'Connect the reader and make sure HID Authentication Device Client is running.')}</p>
      </div>
      {!reader.connected && <button type="button" onClick={reader.retry} aria-label="Retry fingerprint reader" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-current/20 bg-white/70"><RefreshCw size={15} /></button>}
    </div>
  );
}
