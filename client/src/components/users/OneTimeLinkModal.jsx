import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Modal from '../Modal';
import { Button, Field, Input } from '../ui';

/** A link handed to the person who asked for it, shown once, the way the dean invitation link is. */
export default function OneTimeLinkModal({ title, description, label, hint, link, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal open title={title} description={description} onClose={onClose} maxWidth="max-w-xl" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        <Field label={label} hint={hint}>
          <Input readOnly value={link} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
        </Field>
        <Button variant="secondary" leftIcon={copied ? Check : Copy} onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Button>
      </div>
    </Modal>
  );
}
