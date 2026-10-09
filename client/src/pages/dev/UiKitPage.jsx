import { useMemo, useState } from 'react';
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
  DrawnCheck,
  EmptyState,
  ErrorState,
  Field,
  FlowStepper,
  IconButton,
  Input,
  Kbd,
  NextStep,
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
import TableFilterBar from '../../components/TableFilterBar';
import PaginationControls from '../../components/PaginationControls';
import { BarList, Donut, Meter } from '../../components/charts';
import { peso } from '../../lib/format';
import { eventLifecycle, toNextStepProps } from '../../lib/lifecycle';
import notify from '../../lib/notify';

const STATUSES = [
  'paid', 'pending', 'pending_payment', 'payment_submitted', 'verified', 'claimed',
  'cancelled', 'approved', 'rejected', 'draft', 'submitted', 'under_review', 'voting',
  'open', 'closed', 'published', 'planning', 'ongoing', 'completed', 'overdue',
  'in_progress', 'active', 'disabled', 'present', 'late', 'excused', 'absent',
  'owing', 'cleared', 'income', 'expense', 'some_unmapped_state',
];

const TABLE_COLUMNS = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'organization', header: 'Organization' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
];

const TABLE_ROWS = [
  { id: 1, name: 'Maria Santos', organization: 'CCS Student Council', status: 'active' },
  { id: 2, name: 'Juan Cruz', organization: 'CEA Student Council', status: 'pending' },
  { id: 3, name: 'Liza Reyes', organization: 'CBA Student Council', status: 'disabled' },
  { id: 4, name: 'Pedro Penduko', organization: 'CAS Student Council', status: 'active' },
  { id: 5, name: 'Ana Villamor', organization: 'CCJE Student Council', status: 'pending' },
  { id: 6, name: 'Carlos Diaz', organization: 'CCS Student Council', status: 'active' },
  { id: 7, name: 'Rosa Lim', organization: 'CTHM Student Council', status: 'disabled' },
  { id: 8, name: 'Miguel Torres', organization: 'CEA Student Council', status: 'pending' },
];

const STEPPER_STATES = [
  { key: 'proposal', label: 'Proposal', state: 'done', actor: 'Admin' },
  { key: 'requirements', label: 'Requirements', state: 'skipped', actor: 'Admin' },
  { key: 'approval', label: 'Approval', state: 'current', actor: 'Department Head', note: 'Waiting' },
  { key: 'funding', label: 'Funding', state: 'blocked', actor: 'Admin', note: 'Returned' },
  { key: 'prepare', label: 'Prepare', state: 'upcoming', actor: 'Admin, Officers' },
];

const DEMO_EVENT = {
  id: 12,
  status: 'planning',
  approval_status: 'pending',
  approval_required_role: 'DEPARTMENT_HEAD',
  requirements_required: false,
  requires_budget: true,
};

const NEXT_STEP_DEMOS = [
  { tone: 'action', title: 'Propose the event budget', body: 'This event needs funding. The Department Head approves the budget.', actorRole: 'Admin', primary: { label: 'Propose budget', to: '/dev/ui-kit' } },
  { tone: 'waiting', title: 'Waiting for Department Head approval', body: 'No action needed from you.', actorRole: 'Department Head' },
  { tone: 'blocked', title: 'The ballot cannot be finalized yet', body: 'Two positions have no candidates.', primary: { label: 'Finalize ballot', onClick: () => {}, disabledReason: 'Add a candidate to every position first.' } },
  { tone: 'done', title: 'Results released', body: 'Voting is closed and the results are public.', primary: { label: 'View results', to: '/dev/ui-kit' } },
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
  const [search, setSearch] = useState('');
  const [filtersActive, setFiltersActive] = useState(false);
  const [sort, setSort] = useState({ key: 'name', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const sortedRows = useMemo(() => {
    const rows = [...TABLE_ROWS];
    rows.sort((a, b) => {
      const direction = sort.direction === 'asc' ? 1 : -1;
      return String(a[sort.key]).localeCompare(String(b[sort.key])) * direction;
    });
    return rows;
  }, [sort]);

  const pagedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

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
              <Field label="Role (error)" error={fieldError ? 'Choose a role before continuing.' : undefined}>
                <Select defaultValue="">
                  <option value="" disabled>Select a role</option>
                  <option value="officer">SBO Officer</option>
                  <option value="student">Student</option>
                </Select>
              </Field>
              <Field label="Role (disabled)">
                <Select disabled defaultValue="officer">
                  <option value="officer">SBO Officer</option>
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
            <div className="mt-4 flex items-center gap-3">
              <Tooltip content="Saves the current form">
                <Button variant="secondary" size="sm" leftIcon={Save}>Hover for a tooltip</Button>
              </Tooltip>
              <span className="text-sm text-ink-muted">Press <Kbd>Esc</Kbd> to dismiss it.</span>
            </div>
          </Card>
        </Section>

        <Section title="Stats and progress">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Budget balance" value="₱38,200.00" delta="+12%" deltaDirection="up" deltaTone="positive" period="vs last month" />
            <Stat label="Open tasks" value="6" delta="-2" deltaDirection="down" deltaTone="positive" period="this week" context="2 overdue (fewer open tasks is good news)" />
            <Stat label="Merch orders pending" value="14" to="/dev/ui-kit" />
          </div>
          <Card>
            <div className="flex flex-col gap-4">
              <ProgressMeter label="Operating budget" value={42000} max={60000} valueLabel="₱42,000 of ₱60,000" />
              <ProgressMeter label="Warning threshold" value={51} max={60} valueLabel="51 of 60" />
              <ProgressMeter label="Over limit" value={62} max={60} valueLabel="62 of 60" />
            </div>
          </Card>
        </Section>

        <Section title="Flow stepper" description="One lifecycle record, with state shown as icon, text and color. Horizontal from md, vertical below.">
          <Card title="Full, all five states">
            <FlowStepper steps={STEPPER_STATES} ariaLabel="Event progress, every state" />
          </Card>
          <Card title="Full, fed by lifecycle.js (event, waiting on the Department Head)">
            <FlowStepper steps={eventLifecycle(DEMO_EVENT, 'ADMIN').steps} ariaLabel="Event progress" />
          </Card>
          <Card title="Compact, for table rows">
            <div className="grid gap-4 sm:grid-cols-2">
              <FlowStepper variant="compact" steps={STEPPER_STATES} ariaLabel="Compact, current step" />
              <FlowStepper variant="compact" steps={STEPPER_STATES.slice(0, 2).concat({ key: 'x', label: 'Review', state: 'blocked' })} ariaLabel="Compact, blocked" />
              <FlowStepper variant="compact" steps={STEPPER_STATES.map((step) => ({ ...step, state: 'done' }))} ariaLabel="Compact, complete" />
              <FlowStepper variant="compact" steps={STEPPER_STATES} summary="Waiting for Department Head approval" ariaLabel="Compact with narrow-screen summary" />
            </div>
          </Card>
        </Section>

        <Section title="Next step" description="The one callout that says what happens next and who owns it. Waiting never shows a button.">
          <div className="grid gap-3 lg:grid-cols-2">
            {NEXT_STEP_DEMOS.map((demo) => <NextStep key={demo.tone} {...demo} />)}
          </div>
          <NextStep {...toNextStepProps(eventLifecycle(DEMO_EVENT, 'DEPARTMENT_HEAD'))} />
        </Section>

        <Section title="Page header" description="Breadcrumb, one h1, purpose line, meta chips, stepper, next step and one primary action. These previews add h1s to the dev page only. A header that carries a next step with a button keeps its own actions secondary, so only one filled button shows.">
          <Card title="List page: purpose, meta and the one primary button">
            <PageHeader
              breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Events and tasks', to: '/dashboard/events/manage-events' }, { label: 'Events' }]}
              title="Events"
              purpose="Plan, approve and run your organization's events."
              meta={<StatusBadge status="active" label="Needs approval" />}
              actions={<Button variant="secondary" leftIcon={Download}>Export</Button>}
              primary={<Button leftIcon={Plus}>New event</Button>}
            />
          </Card>
          <Card title="Record page: stepper and next step under the title">
            <PageHeader
              breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Events and tasks', to: '/dashboard/events/manage-events' }, { label: 'Events', to: '/dashboard/events/manage-events' }, { label: 'Founders Day' }]}
              title="Founders Day"
              purpose="Plan, approve and run this event from one place."
              meta={<StatusBadge status="planning" />}
              actions={<Button variant="secondary" leftIcon={Download}>Export</Button>}
              stepper={<FlowStepper steps={eventLifecycle(DEMO_EVENT, 'ADMIN').steps} ariaLabel="Event progress" />}
              nextStep={<NextStep {...toNextStepProps(eventLifecycle(DEMO_EVENT, 'ADMIN'))} />}
            />
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
              <EmptyState
                kind="filtered"
                query="budget report"
                description="Try a different search term or clear your filters."
                onClearFilters={() => notify.info('Filters cleared.')}
              />
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

        <Section title="Drawn check" description="One celebratory moment for a success that matters, drawn once over 400ms.">
          <Card>
            <div className="flex items-center gap-4">
              <DrawnCheck label="Your vote is in" />
              <p className="text-sm font-medium text-ink-muted">Used for vote cast, order claimed, and budget approved.</p>
            </div>
          </Card>
        </Section>

        <Section title="Data table" description="Renders as a table at md and up, and as divided rows in the parent Card below md. Sortable, sticky header, with a filter bar and pagination.">
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
              rows={pagedRows}
              loading={tableLoading}
              error={tableError ? 'Could not load organization members.' : null}
              onRetry={() => setTableError(false)}
              actions={(row) => <Button variant="secondary" size="sm">View {row.name.split(' ')[0]}</Button>}
              sort={sort}
              onSortChange={setSort}
              filtersActive={filtersActive}
              filters={(
                <TableFilterBar
                  searchValue={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Search members..."
                  activeFilters={filtersActive ? ['Status: Active'] : []}
                  onClear={() => setFiltersActive(false)}
                  resultCount={sortedRows.length}
                  resultLabel="members"
                  actions={(
                    <Button variant="secondary" size="sm" onClick={() => setFiltersActive((current) => !current)}>
                      Toggle "Status: Active" filter
                    </Button>
                  )}
                />
              )}
              pagination={(
                <PaginationControls
                  currentPage={page}
                  totalItems={sortedRows.length}
                  pageSize={pageSize}
                  pageSizeOptions={[5, 10, 25]}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                  label="members"
                />
              )}
            />
          </Card>
        </Section>

        <Section title="Charts" description="Hand-built SVG charts from components/charts, used read-only here.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Budget by category">
              <BarList
                valueFormat={peso}
                items={[
                  { label: 'Events', value: 18000 },
                  { label: 'Merchandise', value: 9500 },
                  { label: 'Operations', value: 14200 },
                ]}
              />
            </Card>
            <Card title="Orders by status">
              <Donut
                valueFormat={(value) => String(value)}
                centerLabel="Total orders"
                segments={[
                  { label: 'Paid', value: 14 },
                  { label: 'Pending', value: 6 },
                  { label: 'Claimed', value: 9 },
                ]}
              />
            </Card>
          </div>
          <Card title="Budget utilization meter">
            <Meter value={42000} limit={60000} label="Operating budget" format={peso} />
          </Card>
        </Section>

        <Section title="Toasts" description="Every kind, routed through notify.js, including a stacked pair.">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => notify.success('Transaction recorded', { description: '₱1,250.00 added to Operations.' })}
              >
                Success
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => notify.error('We could not save the budget. Try again.')}
              >
                Error
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => notify.info('Voting closes in 2 hours.')}
              >
                Info
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => notify.warning('This budget is close to its limit.')}
              >
                Warning
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => notify.promise(
                  new Promise((resolve) => window.setTimeout(resolve, 1200)),
                  { loading: 'Recording transaction...', success: 'Transaction recorded.', error: 'Could not record the transaction.' },
                )}
              >
                Loading (promise)
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  notify.success('Transaction recorded', { description: '₱1,250.00 added to Operations.' });
                  notify.info('Voting closes in 2 hours.');
                }}
              >
                Stack two toasts
              </Button>
            </div>
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
