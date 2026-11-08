import { useState } from 'react';
import { Button, Field, Input, Textarea } from '../ui';
import RequirementSample from '../requirements/RequirementSample';
import notify from '../../lib/notify';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { openRequirementSample } from '../../utils/requirementSample';
import { fileAccept, fileTypesLabel, validateRequirementFile } from '../../utils/requirementFiles';
import { getApiErrorMessage } from '../../utils/apiError';

const FILE_INPUT = 'block min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded-control file:border-0 file:bg-subtle file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

async function viewSample(requirement) {
  try {
    await openRequirementSample(requirement, { forApplication: true });
  } catch (error) {
    notify.error(getApiErrorMessage(error, 'Could not open the sample file.'));
  }
}

async function viewCurrentFile(document) {
  try {
    await openProtectedFile(document.open_url);
  } catch (error) {
    notify.error(getApiErrorMessage(error, 'Could not open this file.'));
  }
}

export default function ApplicationForm({ requirements, initial, submitLabel, busy = false, errors = {}, onSubmit }) {
  const [fields, setFields] = useState({
    name: initial?.name || '',
    acronym: initial?.acronym || '',
    position_title: initial?.position_title || 'President',
    description: initial?.description || '',
  });
  const [files, setFiles] = useState({});
  const [fileErrors, setFileErrors] = useState({});

  const change = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.value }));

  function chooseFile(requirement, file) {
    const problem = file ? validateRequirementFile(file, requirement.allowed_extensions) : null;
    setFileErrors((current) => ({ ...current, [requirement.id]: problem }));
    setFiles((current) => ({ ...current, [requirement.id]: problem ? null : file }));
  }

  function submit(event) {
    event.preventDefault();
    if (Object.values(fileErrors).some(Boolean)) return;
    onSubmit({ ...fields, name: fields.name.trim(), acronym: fields.acronym.trim(), position_title: fields.position_title.trim() }, files);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">About the organization</legend>
        <Field label="Organization name" required error={errors.name?.[0]}>
          <Input required maxLength={255} value={fields.name} onChange={change('name')} />
        </Field>
        <Field label="Acronym" required error={errors.acronym?.[0]}>
          <Input required maxLength={50} value={fields.acronym} onChange={change('acronym')} />
        </Field>
        <Field label="Your position" required hint="What you will be called in the organization." error={errors.position_title?.[0]}>
          <Input required maxLength={100} value={fields.position_title} onChange={change('position_title')} />
        </Field>
        <Field label="What the organization is for" className="sm:col-span-2" error={errors.description?.[0]}>
          <Textarea rows={3} maxLength={3000} value={fields.description} onChange={change('description')} />
        </Field>
      </fieldset>

      <fieldset disabled={busy} className="space-y-5 border-t border-line pt-5">
        <legend className="text-base font-bold text-ink">Requirements</legend>
        {requirements.map((requirement) => {
          const current = requirement.document;
          const errorText = fileErrors[requirement.id] || errors[`files.${requirement.id}`]?.[0];
          return (
            <div key={requirement.id}>
              <label htmlFor={`requirement-${requirement.id}`} className="block text-[13px] font-semibold text-ink">{requirement.name}{!current && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}</label>
              {requirement.description && <p className="mt-1 text-xs font-medium text-ink-muted">{requirement.description}</p>}
              <p className="mt-1 text-xs font-medium text-ink-muted">Accepted: {fileTypesLabel(requirement.allowed_extensions)}, up to 10 MB.</p>
              <RequirementSample requirement={requirement} onOpen={viewSample} />
              {current && (
                <p className="mb-2 text-sm text-ink-muted">
                  Current file:{' '}
                  <button type="button" onClick={() => viewCurrentFile(current)} className="min-h-11 font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">{current.name}</button>
                  . Choose a file only to replace it.
                </p>
              )}
              <input
                id={`requirement-${requirement.id}`}
                type="file"
                accept={fileAccept(requirement.allowed_extensions)}
                required={!current}
                aria-invalid={Boolean(errorText)}
                aria-describedby={errorText ? `requirement-error-${requirement.id}` : undefined}
                onChange={(event) => chooseFile(requirement, event.target.files?.[0] || null)}
                className={FILE_INPUT}
              />
              {errorText && <p id={`requirement-error-${requirement.id}`} role="alert" className="mt-1 text-xs font-semibold text-danger-strong">{errorText}</p>}
            </div>
          );
        })}
      </fieldset>

      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  );
}
