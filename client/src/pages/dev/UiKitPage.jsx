import { useState } from 'react';
import {
  BellRing,
  CalendarDays,
  Download,
  Megaphone,
  Plus,
  Save,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Kbd,
  OrgMark,
  PageHeader,
  ProgressMeter,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonCard,
  SkeletonStat,
  SkeletonTable,
  SkeletonText,
  Stat,
  StatusBadge,
  Tabs,
  Textarea,
  Tooltip,
} from '../../components/ui';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';

const STATUSES = [
  'paid', 'pending', 'pending_payment', 'payment_submitted', 'verified', 'claimed',
  'cancelled', 'approved', 'rejected', 'draft', 'submitted', 'under_review', 'voting',
  'open', 'closed', 'published', 'planning', 'ongoing', 'completed', 'overdue',
  'in_progress', 'active', 'disabled', 'present', 'late', 'excused', 'absent',
  'owing', 'cleared', 'income', 'expense', 'some_unmapped_state',
];

const TABLE_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'organization', header: 'Organization' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
];

const TABLE_ROWS = [
  { id: 1, name: 'Maria Santos', organization: 'CCS Student Council', status: 'active' },
  { id: 2, name: 'Juan Cruz', organization: 'CEA Student Council', status: 'pending' },
  { id: 3, name: 'Liza Reyes', organization: 'CBA Student Council', status: 'disabled' },
];

function Section({ title, description, children }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm font-medium text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function UiKitPage() {
  const [tab, setTab] = useState('overview');
  const [segment, setSegment] = useState('week');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState(false);
  const [fieldError, setFieldError] = useState(true);

  return (
    <div className="min-h-screen bg-page px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-12">
        <PageHeader
          title="HIUSA UI Kit"
          description="Every shared component in every state. Dev-only, for design review and screenshots."
          meta={<StatusBadge status="active" label="Dev environment" />}
        />

        <Section title="Buttons" description="Variants, sizes, loading and disabled states.">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Record transaction</Button>
              <Button variant="secondary">Cancel</Button>
              <Button variant="danger" leftIcon={Trash2}>Delete event</Button>
              <Button variant="ghost">Ghost action</Button>
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary" size="lg">Large</Button>
              <Button variant="primary" loading>Saving</Button>
              <Button variant="primary" disabled>Disabled</Button>
              <Button variant="secondary" leftIcon={Download} rightIcon={Plus}>Both icons</Button>
              <Button variant="primary" to="/dev/ui-kit">Router link</Button>
            </div>
          </Card>
          <Card title="Icon buttons">
            <div className="flex flex-wrap items-center gap-3">
              <IconButton icon={Plus} label="Add item" variant="primary" />
              <IconButton icon={Save} label="Save" variant="secondary" />
              <IconButton icon={Trash2} label="Delete" variant="danger" />
              <IconButton icon={BellRing} label="Notifications" variant="ghost" />
              <IconButton icon={Plus} label="Add item (small)" size="sm" />
              <IconButton icon={Plus} label="Add item (disabled)" disabled />
              <Tooltip content="Saves the current form">
                <IconButton icon={Save} label="Save with tooltip" variant="secondary" />
              </Tooltip>
            </div>
          </Card>
        </Section>

        <Section title="Fields" description="Input, Select and Textarea, with hints, errors and disabled state.">
          <Card>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Organization name" hint="Shown across the whole system.">
                <Input placeholder="CCS Student Council" />
              </Field>
              <Field label="Email address" required error={fieldError ? 'Enter a valid email address.' : undefined}>
                <Input type="email" placeholder="officer@uclm.edu.ph" />
              </Field>
              <Field label="Role">
                <Select defaultValue="officer">
                  <option value="admin">Admin</option>
                  <option value="officer">SBO Officer</option>
                  <option value="student">Student</option>
                </Select>
              </Field>
              <Field label="Disabled field">
                <Input placeholder="Not editable" disabled />
              </Field>
              <Field label="Remarks" className="sm:col-span-2">
                <Textarea placeholder="Add context for the reviewer..." />
              </Field>
            </div>
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={() => setFieldError((current) => !current)}>
                Toggle field error
              </Button>
            </div>
          </Card>
        </Section>

        <Section title="Status badges" description="Every status string resolved through statusTones.js.">
          <Card>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => <StatusBadge key={status} status={status} />)}
            </div>
          </Card>
        </Section>

        <Section title="Tabs and segmented control">
          <Card>
            <Tabs
              tabs={[
                { key: 'overview', label: 'Overview', icon: Wallet },
                { key: 'events', label: 'Events', icon: CalendarDays },
                { key: 'announcements', label: 'Announcements', icon: Megaphone },
              ]}
              value={tab}
              onChange={setTab}
            />
            <p className="mt-4 text-sm font-medium text-ink-muted">Active tab: <span className="font-bold text-ink">{tab}</span></p>
            <div className="mt-5">
              <SegmentedControl
                options={[{ value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }]}
                value={segment}
                onChange={setSegment}
              />
            </div>
          </Card>
        </Section>

        <Section title="Stats and progress">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Budget balance" value="₱38,200.00" delta="+12%" deltaDirection="up" period="vs last month" />
            <Stat label="Open tasks" value="6" delta="-2" deltaDirection="down" period="this week" context="2 overdue" />
            <Stat label="Merch orders pending" value="14" to="/dev/ui-kit" />
          </div>
          <Card>
            <div className="flex flex-col gap-4">
              <ProgressMeter label="Operating budget" value={42} max={60000} valueLabel="₱42,000 of ₱60,000" />
              <ProgressMeter label="Warning threshold" value={51} max={60} valueLabel="51 of 60" />
              <ProgressMeter label="Over limit" value={62} max={60} valueLabel="62 of 60" />
            </div>
          </Card>
        </Section>

        <Section title="Avatars, org marks, kbd">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name="Maria Santos" />
              <Avatar name="Juan Cruz" size="lg" />
              <OrgMark name="CCS Student Council" acronym="CCS" />
              <OrgMark name="College of Engineering" />
              <span className="text-sm text-ink-muted">Press <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> to open the command palette.</span>
            </div>
          </Card>
        </Section>

        <Section title="Empty, error and loading states">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="First-run">
              <EmptyState
                kind="first-run"
                icon={Megaphone}
                title="No announcements yet"
                description="Once your organization publishes an announcement, it will show up here for every member."
                action={<Button variant="primary" size="sm" leftIcon={Plus}>Create announcement</Button>}
              />
            </Card>
            <Card title="Filtered">
              <EmptyState kind="filtered" query="budget report" description="Try a different search term or clear your filters." />
            </Card>
            <Card title="Restricted">
              <EmptyState kind="restricted" title="Only officers can see this" description="Ask your organization admin for access." />
            </Card>
            <Card title="Error">
              <ErrorState description="We could not load your tasks. Check your connection and try again." onRetry={() => {}} />
            </Card>
          </div>
          <Card title="Skeletons">
            <div className="flex flex-col gap-4">
              <Skeleton className="h-4 w-1/3" />
              <SkeletonText lines={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SkeletonCard />
                <SkeletonStat />
              </div>
              <SkeletonTable rows={3} columns={3} />
            </div>
          </Card>
        </Section>

        <Section title="Data table" description="Renders as a table at md and up, and as stacked cards below md.">
          <Card
            actions={(
              <>
                <Button variant="secondary" size="sm" onClick={() => setTableLoading((current) => !current)}>Toggle loading</Button>
                <Button variant="secondary" size="sm" onClick={() => setTableError((current) => !current)}>Toggle error</Button>
              </>
            )}
          >
            <DataTable
              columns={TABLE_COLUMNS}
              rows={TABLE_ROWS}
              loading={tableLoading}
              error={tableError ? 'Could not load organization members.' : null}
              onRetry={() => setTableError(false)}
              actions={(row) => <Button variant="secondary" size="sm">View {row.name.split(' ')[0]}</Button>}
              emptyState={<EmptyState kind="filtered" description="No members match your filters." />}
            />
          </Card>
        </Section>

        <Section title="Drawer and modals">
          <Card>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setDrawerOpen(true)}>Open drawer</Button>
              <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>Open confirm modal</Button>
            </div>
          </Card>
        </Section>

        <Drawer
          open={drawerOpen}
          title="Event details"
          description="General Assembly, September 30"
          onClose={() => setDrawerOpen(false)}
          footer={<Button variant="primary" onClick={() => setDrawerOpen(false)}>Done</Button>}
        >
          <p className="text-sm font-medium text-ink-muted">Drawer content goes here: facts, a timeline, a form.</p>
        </Drawer>

        <Modal
          open={modalOpen}
          title="Create announcement"
          description="Visible to the audience you choose."
          onClose={() => setModalOpen(false)}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>Publish announcement</Button>
            </>
          )}
        >
          <Field label="Title"><Input placeholder="Org week schedule" /></Field>
        </Modal>

        <ConfirmModal
          open={confirmOpen}
          title="Delete this event?"
          message="Its tasks and attendance records will be removed."
          recordName="General Assembly"
          confirmText="Delete event"
          variant="danger"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => setConfirmOpen(false)}
        />
      </div>
    </div>
  );
}
