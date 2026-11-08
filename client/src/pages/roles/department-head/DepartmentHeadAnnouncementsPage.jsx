import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Megaphone, PencilLine, Plus, Send, Trash2 } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import TableRowActions from '../../../components/TableRowActions';
import { createAnnouncement, deleteAnnouncement, getAnnouncements, togglePublish, updateAnnouncement } from '../../../services/announcementService';
import { getCollegeOrganizations } from '../../../services/collegeOrganizationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';

const emptyForm = () => ({ organization_id: '', title: '', body: '', target_role: 'all', category: 'general' });

export default function DepartmentHeadAnnouncementsPage() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: { total: 0, currentPage: 1, perPage: 10 } });
  const [organizations, setOrganizations] = useState([]);
  const [optionPage, setOptionPage] = useState(0);
  const [optionLastPage, setOptionLastPage] = useState(1);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionError, setOptionError] = useState('');
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    let current = true;
    setState((value) => ({ ...value, loading: true, error: '' }));
    getAnnouncements({ managed: 1, page, per_page: 10 })
      .then((response) => { if (current) setState({ loading: false, error: '', rows: unwrapList(response.data), meta: listMeta(response.data) }); })
      .catch((cause) => { if (current) setState((value) => ({ ...value, loading: false, error: getApiErrorMessage(cause, 'Could not load your announcements.') })); });
    return () => { current = false; };
  }, [page]);
  useEffect(load, [load]);

  async function loadOrganizations(nextPage = 1) {
    setOptionsLoading(true);
    setOptionError('');
    try {
      const response = await getCollegeOrganizations({ page: nextPage, per_page: 50, lifecycle_status: 'active' });
      setOrganizations((current) => nextPage === 1 ? unwrapList(response.data) : [...current, ...unwrapList(response.data)]);
      const meta = listMeta(response.data);
      setOptionPage(nextPage);
      setOptionLastPage(meta.lastPage);
    } catch (cause) { setOptionError(getApiErrorMessage(cause, 'Could not load organizations.')); }
    finally { setOptionsLoading(false); }
  }

  function openEditor(row = null) {
    setForm(row ? { ...row, organization_id: String(row.organization_id) } : emptyForm());
    setError('');
    setErrors({});
    if (organizations.length === 0) loadOrganizations();
  }

  async function save(event, publish = false) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const data = { title: form.title.trim(), body: form.body.trim(), target_role: form.target_role, category: form.category };
      if (form.id) await updateAnnouncement(form.id, data);
      else await createAnnouncement({ ...data, organization_id: Number(form.organization_id), is_published: publish });
      setForm(null);
      setNotice(form.id ? 'Announcement updated.' : publish ? 'Announcement published to the selected organization.' : 'Announcement saved as a draft.');
      load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not save this announcement.'));
      setErrors(cause.response?.data?.errors || {});
    } finally { setBusy(false); }
  }

  async function changePublication(row) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await togglePublish(row.id);
      setNotice(row.is_published ? 'Announcement unpublished.' : 'Announcement published.');
      load();
    } catch (cause) { setError(getApiErrorMessage(cause, 'Could not change publication.')); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (busy || !deleting) return;
    setBusy(true);
    setError('');
    try {
      await deleteAnnouncement(deleting.id);
      setDeleting(null);
      setNotice('Announcement deleted.');
      if (page > 1 && state.rows.length === 1) setPage(page - 1);
      else load();
    } catch (cause) { setError(getApiErrorMessage(cause, 'Could not delete this announcement.')); }
    finally { setBusy(false); }
  }

  const columns = [
    { key: 'title', header: 'Announcement', render: (row) => <span className="font-medium">{row.title}</span> },
    { key: 'organization', header: 'Organization', render: (row) => row.organization?.name },
    { key: 'status', header: 'Status', render: (row) => (row.is_published ? null : <StatusBadge status="draft" />) },
  ];
  const change = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setErrors((current) => ({ ...current, [key]: undefined })); };
  return <div className="space-y-5 pb-8">
    <PageHeader title="College announcements" primary={<Button leftIcon={Plus} onClick={() => openEditor()}>New announcement</Button>} />
    <Link to="/dashboard/announcements/view-announcements" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">View announcement feed</Link>
    {notice && <p role="status" className="text-sm font-semibold text-success-strong">{notice}</p>}
    {error && !form && !deleting && <p role="alert" className="text-sm text-danger-strong">{error}</p>}
    <Card bodyClassName="p-0">
      <div className="px-4 py-2">
        <DataTable
          caption="Announcements created by you"
          columns={columns}
          rows={state.rows}
          rowKey={(row) => row.id}
          loading={state.loading}
          error={state.error}
          onRetry={load}
          stickyHeader={false}
          emptyState={<EmptyState icon={Megaphone} title="No announcements yet" description="Write the first one for an organization in your college." />}
          actions={(row) => (
            <TableRowActions subject={row.title} actions={[
              { label: 'Edit announcement', icon: PencilLine, disabled: busy, onClick: () => openEditor(row) },
              { label: row.is_published ? 'Unpublish' : 'Publish', icon: row.is_published ? Eye : Send, disabled: busy, onClick: () => changePublication(row) },
              { label: 'Delete announcement', icon: Trash2, danger: true, disabled: busy, onClick: () => { setError(''); setDeleting(row); } },
            ]} />
          )}
          actionsHeader=""
          pagination={state.error ? null : <PaginationControls currentPage={state.meta.currentPage} totalItems={state.meta.total} pageSize={10} onPageChange={setPage} label="announcements" />}
        />
      </div>
    </Card>
    <Drawer open={Boolean(form)} title={form?.id ? 'Edit announcement' : 'New announcement'} onClose={busy ? undefined : () => setForm(null)} footer={<>{!form?.id && <Button variant="secondary" type="submit" form="college-announcement" name="publication" value="draft" disabled={busy || !form?.organization_id}>Save draft</Button>}<Button type="submit" form="college-announcement" name="publication" value="publish" loading={busy} disabled={!form?.organization_id}>{form?.id ? 'Save changes' : 'Publish announcement'}</Button></>}>
      {form && <form id="college-announcement" className="space-y-4" onSubmit={(event) => save(event, event.nativeEvent.submitter?.value === 'publish')}>
        <Field label="Organization" required error={errors.organization_id?.[0]}><Select required value={form.organization_id} onChange={change('organization_id')} disabled={busy || optionsLoading || Boolean(form.id)}><option value="">{optionsLoading ? 'Loading organizations...' : 'Choose an organization'}</option>{form.id && !organizations.some((org) => String(org.id) === form.organization_id) && <option value={form.organization_id}>{form.organization?.name || 'Selected organization'}</option>}{organizations.map((org) => <option key={org.id} value={org.id} disabled={org.is_active === false}>{org.name}</option>)}</Select></Field>
        {optionError && <p role="alert" className="text-sm text-danger-strong">{optionError} <Button size="sm" variant="secondary" onClick={() => loadOrganizations(optionPage + 1)}>Retry</Button></p>}
        {optionPage < optionLastPage && !optionError && <Button variant="secondary" size="sm" disabled={optionsLoading || busy} onClick={() => loadOrganizations(optionPage + 1)}>Load more organizations</Button>}
        {!optionsLoading && !optionError && optionPage > 0 && organizations.length === 0 && <p role="status" className="text-sm text-ink-muted">No active organizations are available in your college.</p>}
        <Field label="Title" required error={errors.title?.[0]}><Input required maxLength={255} value={form.title} disabled={busy} onChange={change('title')} /></Field>
        <Field label="Message" required error={errors.body?.[0]}><Textarea required rows={6} value={form.body} disabled={busy} onChange={change('body')} /></Field>
        <Field label="Audience" required error={errors.target_role?.[0]}><Select value={form.target_role} disabled={busy} onChange={change('target_role')}><option value="all">All organization members</option><option value="STUDENT">Students</option><option value="SBO_OFFICER">Officers</option><option value="ADMIN">Organization Admins</option></Select></Field>
        {error && <p role="alert" className="text-sm text-danger-strong">{error}</p>}
      </form>}
    </Drawer>
    <ConfirmModal open={Boolean(deleting)} title="Delete announcement?" recordName={deleting?.title} message="This removes your announcement from the selected organization." confirmText="Delete announcement" busy={busy} error={error} onCancel={() => setDeleting(null)} onConfirm={remove} />
  </div>;
}
