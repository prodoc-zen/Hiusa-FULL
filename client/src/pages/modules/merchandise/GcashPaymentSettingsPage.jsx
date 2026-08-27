import { useEffect, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import FeedbackToast from '../../../components/FeedbackToast';
import { getGcashSettings, uploadGcashQr } from '../../../services/merchandiseService';
import { resolveAssetUrl } from '../../../utils/assetUrl';

export default function GcashPaymentSettingsPage() {
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
    try {
      const response = await uploadGcashQr(file);
      setSettings(response.data ?? response);
      setImageError(false);
      setFile(null);
      setFeedback({ open: true, type: 'success', message: 'GCash QR code updated. Students can now use it at merchandise checkout.' });
    } catch (requestError) {
      setError(requestError.response?.data?.errors?.qr_code?.[0] || requestError.response?.data?.message || 'Unable to upload the QR code.');
    } finally { setBusy(false); }
  };

  const imageUrl = preview || (settings?.gcash_qr_url ? resolveAssetUrl(settings.gcash_qr_url) : '');
  return <div className="space-y-5">
    <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
    <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Merchandise payment</p>
      <h2 className="mt-1 text-2xl font-black text-[#0F172A]">GCash QR Code</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">Upload the organization’s official QR image. It is shown to students only when they select GCash during merchandise checkout.</p>
    </section>
    <section className="grid gap-5 rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm lg:grid-cols-[280px_1fr]">
      <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-[#B9D9E9] bg-[#F8FBFD] p-4">
        {imageUrl && !imageError ? <img src={imageUrl} alt="Current official GCash payment QR code" onError={() => setImageError(true)} className="max-h-64 max-w-full rounded-lg object-contain" /> : <div className="text-center text-slate-500"><ImagePlus className="mx-auto mb-3 text-[#0B8ED0]" size={30} /><p className="text-sm font-bold">{imageError ? 'Saved image could not be loaded' : 'No QR code uploaded'}</p>{imageError && <a href={imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-[#0B8ED0] underline">Open saved image</a>}</div>}
      </div>
      <form onSubmit={save} className="flex flex-col justify-center">
        <label className="text-sm font-bold text-[#0F172A]">Official GCash QR image</label>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setError(''); }} className="mt-2 block w-full rounded-lg border border-[#DDE7EF] p-2 text-sm" />
        <p className="mt-2 text-xs text-slate-500">PNG, JPG, or WEBP only, up to 5 MB. Replacing it removes the previous QR image.</p>
        {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="mt-5 inline-flex h-11 w-fit items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50"><Upload size={16} />{busy ? 'Uploading...' : 'Save GCash QR'}</button>
      </form>
    </section>
  </div>;
}
