import { useEffect, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import FeedbackToast from '../../../components/FeedbackToast';
import { Button, Field, Input } from '../../../components/ui';
import { getGcashSettings, uploadGcashQr } from '../../../services/merchandiseService';
import { resolveAssetUrl } from '../../../utils/assetUrl';

export default function GcashPaymentSettingsPage({ embedded = false, readOnly = false, showHeading = true, onBusyChange, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [imageError, setImageError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  useEffect(() => {
    getGcashSettings().then((response) => { setSettings(response.data ?? response); setImageError(false); }).catch(() => setError('Unable to load the GCash QR setting.'));
  }, []);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const save = async (event) => {
    event.preventDefault();
    if (!file) { setError('Choose a QR image to upload.'); return; }
    setBusy(true); setError('');
    onBusyChange?.(true);
    try {
      const response = await uploadGcashQr(file);
      setSettings(response.data ?? response);
      onSaved?.(response.data ?? response);
      setImageError(false);
      setFile(null);
      setFeedback({ open: true, type: 'success', message: 'GCash QR code updated. Students can now use it at merchandise checkout.' });
    } catch (requestError) {
      setError(requestError.response?.data?.errors?.qr_code?.[0] || requestError.response?.data?.message || 'Unable to upload the QR code.');
    } finally { setBusy(false); onBusyChange?.(false); }
  };

  const imageUrl = preview || (settings?.gcash_qr_url ? resolveAssetUrl(settings.gcash_qr_url) : '');
  return <div className="space-y-4">
    <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
    {showHeading && <section>
      <h2 className={`font-semibold text-ink ${embedded ? 'text-lg' : 'text-xl sm:text-2xl'}`}>GCash QR code</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted-strong">Upload the organization’s official QR image. Students see it only when they choose GCash at merchandise checkout.</p>
    </section>}
    {error && <p role="alert" className="rounded-control border border-danger/40 bg-danger-tint px-3 py-2 text-sm font-medium text-danger-strong">{error}</p>}
    <section className={embedded ? (readOnly ? 'mx-auto max-w-xs' : 'grid items-start gap-5 sm:grid-cols-[200px_minmax(0,1fr)]') : 'grid gap-5 lg:grid-cols-[280px_1fr]'}>
      <div className={`flex items-center justify-center rounded-control border border-dashed border-line p-4 ${embedded ? 'min-h-40' : 'min-h-64'}`}>
        {imageUrl && !imageError ? <img src={imageUrl} alt="Current official GCash payment QR code" onError={() => setImageError(true)} className="max-h-64 max-w-full rounded-control object-contain" /> : <div className="text-center text-ink-muted"><ImagePlus className="mx-auto mb-3 text-ink-soft" size={30} aria-hidden="true" /><p className="text-sm font-semibold">{imageError ? 'Saved image could not be loaded' : 'No QR code uploaded'}</p>{imageError && <a href={imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2">Open saved image</a>}</div>}
      </div>
      {!readOnly && <form onSubmit={save} className="flex flex-col justify-center">
        <Field label="Official GCash QR image" hint="PNG, JPG or WEBP, up to 5 MB. Replacing it removes the previous QR image.">
          <Input id="organization-gcash-qr" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setError(''); }} className="py-1.5" />
        </Field>
        <Button type="submit" disabled={busy} leftIcon={Upload} className="mt-5 w-fit">{busy ? 'Uploading...' : 'Save GCash QR'}</Button>
      </form>}
    </section>
  </div>;
}
