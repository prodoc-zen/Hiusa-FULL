import { ShieldCheck, MessageSquareText } from 'lucide-react';
import { RichTextBody } from '../../../../components/RichText';
import { Card, EmptyState, ErrorState, Skeleton, SkeletonCard, StatusBadge } from '../../../../components/ui';
import { StackedBar } from '../../../../components/charts';
import { manilaDate } from '../../../../lib/format';
import {
  LIKERT_SCALE_LABELS,
  RESPONDENT_TYPE_ORDER,
  interpretationTone,
  respondentTypeLabel,
} from '../evaluationMeta';

function AnonymitySuppressedNotice({ message, n }) {
  return (
    <div className="flex items-start gap-3 rounded-control border border-line bg-subtle p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
        <ShieldCheck size={18} aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-bold text-ink">{n} {n === 1 ? 'response' : 'responses'} collected</p>
        <p className="mt-1 text-sm leading-6 text-ink-muted">{message}</p>
      </div>
    </div>
  );
}

function ItemDistribution({ item, promptMap }) {
  const label = promptMap?.[item.code] || item.code;
  const segments = [1, 2, 3, 4, 5].map((score) => ({
    label: LIKERT_SCALE_LABELS[score],
    value: item.distribution[score] || 0,
    tone: score >= 4 ? 'success' : score === 3 ? 'warning' : 'danger',
  }));

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink" title={label}>{label}</p>
        <p className="shrink-0 text-xs font-medium tabular-nums text-ink-muted">
          Mean {item.mean.toFixed(2)} &middot; SD {item.sd.toFixed(2)} &middot; n={item.n}
        </p>
      </div>
      <div className="mt-2">
        <StackedBar segments={segments} valueFormat={(value) => String(value)} />
      </div>
    </li>
  );
}

function GroupResults({ type, group, promptMap }) {
  if (group.anonymized) {
    return (
      <Card title={respondentTypeLabel(type)}>
        <AnonymitySuppressedNotice message={group.message} n={group.n} />
      </Card>
    );
  }

  const sections = Object.entries(group.sections || {});

  return (
    <Card
      title={respondentTypeLabel(type)}
      description={`${group.n} ${group.n === 1 ? 'respondent' : 'respondents'}`}
      actions={<StatusBadge tone={interpretationTone(group.overall_label)} label={`Overall: ${group.overall_mean.toFixed(2)} ${group.overall_label}`} />}
    >
      <div className="flex flex-col gap-6">
        {sections.map(([sectionCode, section]) => (
          <div key={sectionCode}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <div>
                <p className="text-sm font-bold text-ink">{section.label}</p>
                {section.objective && <p className="text-xs font-semibold text-ink-soft">Objective {section.objective}</p>}
              </div>
              <StatusBadge tone={interpretationTone(section.label_interpretation)} label={`${section.mean.toFixed(2)} ${section.label_interpretation}`} />
            </div>
            <ul className="divide-y divide-line-soft">
              {section.items.map((item) => (
                <ItemDistribution key={item.code} item={item} promptMap={promptMap} />
              ))}
            </ul>
          </div>
        ))}

        <div className="border-t border-line pt-4">
          <div className="mb-2 flex items-center gap-2">
            <MessageSquareText size={16} className="text-ink-soft" aria-hidden="true" />
            <p className="text-sm font-bold text-ink">Open-ended feedback</p>
          </div>
          {group.feedback && group.feedback.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {group.feedback.map((entry, index) => (
                <li key={index} className="rounded-control border border-line bg-subtle p-3 text-sm leading-6 text-ink-muted">
                  &ldquo;{entry}&rdquo;
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-medium text-ink-muted">No written feedback was submitted for this group.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function EvaluationResultsPanel({ data, loading, error, onRetry, promptMap, itemLabelNote }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    return <ErrorState description={error} onRetry={onRetry} />;
  }

  if (!data || !data.window) {
    return (
      <EmptyState
        kind="first-run"
        icon={ShieldCheck}
        title="No closed evaluation window yet"
        description="Results appear here once an evaluation window is closed. Nothing is fabricated: this stays empty until real responses come in."
      />
    );
  }

  const groupEntries = Object.entries(data.groups || {}).sort(
    ([a], [b]) => RESPONDENT_TYPE_ORDER.indexOf(a) - RESPONDENT_TYPE_ORDER.indexOf(b),
  );

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={data.window.title}
        description={data.window.description ? <RichTextBody as="span" value={data.window.description} /> : undefined}
        actions={<StatusBadge status={data.window.status} />}
      >
        <p className="text-sm font-medium text-ink-muted">
          {data.window.opens_at ? `Opened ${manilaDate(data.window.opens_at, 'long')}` : 'No open date set'}
          {' · '}
          {data.window.closes_at ? `Closed ${manilaDate(data.window.closes_at, 'long')}` : 'No close date set'}
        </p>
        {data.counts_only && (
          <p className="mt-3 rounded-control border border-line bg-subtle p-3 text-sm font-medium text-ink-muted">
            This window has not closed yet, so only response counts are shown. Full results appear once it closes.
          </p>
        )}
        {itemLabelNote && (
          <p className="mt-3 text-xs font-medium text-ink-soft">{itemLabelNote}</p>
        )}
      </Card>

      {groupEntries.length === 0 ? (
        <EmptyState
          kind="first-run"
          icon={ShieldCheck}
          title="No responses yet"
          description="No one in this scope has answered this window yet."
        />
      ) : data.counts_only ? (
        <Card title="Responses collected so far">
          <ul className="flex flex-col divide-y divide-line-soft">
            {groupEntries.map(([type, group]) => (
              <li key={type} className="flex items-center justify-between py-3 text-sm font-semibold text-ink">
                <span>{respondentTypeLabel(type)}</span>
                <span className="tabular-nums text-ink-muted">{group.n}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        groupEntries.map(([type, group]) => (
          <GroupResults key={type} type={type} group={group} promptMap={promptMap} />
        ))
      )}
    </div>
  );
}
