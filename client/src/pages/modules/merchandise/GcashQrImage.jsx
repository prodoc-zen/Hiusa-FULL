import { useEffect, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import { Button } from '../../../components/ui';
import { getGcashQrImage } from '../../../services/merchandiseService';

// The QR is behind a sign-in, so it is fetched as a blob; a missing file or a failed load shows a plain notice, never a broken image.
export default function GcashQrImage({ openUrl, alt, className = '', onUpload }) {
  const [state, setState] = useState({ status: openUrl ? 'loading' : 'missing', src: '' });

  useEffect(() => {
    if (!openUrl) { setState({ status: 'missing', src: '' }); return undefined; }
    let active = true;
    let objectUrl = '';
    setState({ status: 'loading', src: '' });
    getGcashQrImage(openUrl)
      .then((response) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data ?? response);
        setState({ status: 'ready', src: objectUrl });
      })
      .catch(() => { if (active) setState({ status: 'missing', src: '' }); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [openUrl]);

  if (state.status === 'ready') {
    return <img src={state.src} alt={alt} onError={() => setState({ status: 'missing', src: '' })} className={className} />;
  }

  if (state.status === 'loading') {
    return <p role="status" className="text-sm text-ink-muted">Loading the QR code...</p>;
  }

  return (
    <div className="text-center text-ink-muted">
      <ImagePlus className="mx-auto mb-3 text-ink-soft" size={30} aria-hidden="true" />
      <p className="text-sm font-semibold">QR not available</p>
      {onUpload && <Button type="button" variant="secondary" leftIcon={Upload} onClick={onUpload} className="mt-3">Upload a QR</Button>}
    </div>
  );
}
