import { useState } from 'react';
import { Drawer } from '../ui';
import StaffInvitePanel from './StaffInvitePanel';
import PendingStaffInvites from './PendingStaffInvites';

export default function AddStaffModal({ open, onClose }) {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <Drawer
      open={open}
      title="Add office staff"
      description="Faculty or other staff you trust with your college's work. They get a link that works once and expires in 48 hours."
      onClose={onClose}
      width="max-w-lg"
    >
      <div className="flex flex-col gap-6">
        {open && <StaffInvitePanel onCreated={() => setReloadKey((count) => count + 1)} onCancel={onClose} />}
        {open && <PendingStaffInvites reloadKey={reloadKey} />}
      </div>
    </Drawer>
  );
}
