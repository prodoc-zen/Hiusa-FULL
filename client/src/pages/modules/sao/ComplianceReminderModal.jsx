import { useState } from 'react';
import { Button, Drawer, Field, Select, Textarea } from '../../../components/ui';
import { sendComplianceReminder } from '../../../services/complianceService';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';

export default function ComplianceReminderModal({ organization, requirementId, onClose }) {
  const requirements = organization.requirements.filter((item) => item.status !== 'approved');
  const [selectedId, setSelectedId] = useState(String(requirementId || requirements[0]?.requirement_type_id || ''));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(event) {
    event.preventDefault();
    if (!selectedId || message.trim().length < 5 || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await sendComplianceReminder(organization.organization_id, { requirement_type_id: Number(selectedId), message: message.trim() });
      notify.success(`Reminder sent to ${response.data.recipient_count} recipients.`);
      onClose();
    } catch (failure) {
      setError(getApiErrorMessage(failure, 'Could not send this reminder. Try again.'));
    } finally { setBusy(false); }
  }

  return <Drawer open title={`Notify ${organization.organization_name}`} description="Your message appears in Announcements and notifications for active members and their Department Head." onClose={busy ? undefined : onClose} footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" form="compliance-reminder-form" loading={busy} disabled={!selectedId || message.trim().length < 5}>Send reminder</Button></>}>
    <form id="compliance-reminder-form" onSubmit={send} className="space-y-4">
      <Field label="Requirement" required><Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{requirements.map((item) => <option key={item.requirement_type_id} value={item.requirement_type_id}>{item.requirement_name}</option>)}</Select></Field>
      <Field label="Message" required hint="Say what they need to submit or correct."><Textarea rows={4} minLength={5} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} /></Field>
      {error && <p role="alert" className="text-sm text-danger-strong">{error}</p>}
    </form>
  </Drawer>;
}
