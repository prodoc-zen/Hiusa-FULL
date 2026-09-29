import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Printer } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import PageHeader from '../../../components/ui/PageHeader';
import { SkeletonCard } from '../../../components/ui/Skeleton';
import { getObjectivesOverview } from '../../../services/objectivesService';
import GeneralObjectiveBanner from './GeneralObjectiveBanner';
import ResearchFoundationSection from './ResearchFoundationSection';
import So2PillarSystem from './So2PillarSystem';
import SynthesisSection from './SynthesisSection';

const SO2_CODES = ['SO2.1', 'SO2.2', 'SO2.3', 'SO2.4', 'SO2.5', 'SO2.6'];

// This page lives inside the dashboard shell: a fixed-height div wrapping a
// <main class="overflow-y-auto">, itself wrapped in another overflow-hidden
// div, which a plain @media print rule would clip to one screen. Verified
// against a stand-in of DashboardLayout.jsx's real classes (not just this
// page in isolation): position:absolute does not escape the clip the way it
// normally would, because <Outlet/> is wrapped in ".route-fade-in", whose
// entrance animation leaves a resting (identity) transform on it, and any
// transform makes an element a containing block, so the "escape" still lands
// inside the clipped ancestors. The robust fix is to stop those ancestors
// from clipping at all: hide the sidebar (<aside>) and top bar (a <header>
// outside this page - Card's own header slot is a <header> too, so a bare
// tag selector would blank out every section title), then let <main> and its
// wrapping divs grow to their natural height. This does not touch the
// shell's own files (owned by a different Wave B slice).
const PRINT_STYLES = `
  @page { size: A4; margin: 14mm; }
  @media print {
    aside, header:not(.objectives-page header) { display: none !important; }
    div:has(main) { height: auto !important; max-height: none !important; overflow: visible !important; background: #fff !important; }
    main { height: auto !important; overflow: visible !important; padding: 0 !important; background: #fff !important; }
    body { background: #fff !important; }
    .objectives-page { padding: 0 !important; }
    .objectives-no-print { display: none !important; }
    .objectives-page > * { break-inside: avoid; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
`;

function groupObjectives(objectives) {
  const byCode = new Map(objectives.map((objective) => [objective.code, objective]));
  return {
    general: byCode.get('GO') || null,
    so1: byCode.get('SO1') || null,
    so4: byCode.get('SO4') || null,
    so3: byCode.get('SO3') || null,
    so2: SO2_CODES.map((code) => byCode.get(code)).filter(Boolean),
  };
}

function scopeSentence(scope) {
  if (!scope) return '';
  if (scope.type === 'university') {
    return 'University-wide evidence across every organization, for the Student Affairs Office.';
  }
  return `Evidence scoped to ${scope.organization?.name || 'your organization'} only.`;
}

export default function StudyObjectivesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getObjectivesOverview()
      .then((response) => setData(response.data))
      .catch(() => setError('Study objectives could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const objectives = Array.isArray(data?.objectives) ? data.objectives : [];
  const grouped = groupObjectives(objectives);

  return (
    <div className="objectives-page space-y-6">
      <style>{PRINT_STYLES}</style>

      <PageHeader
        title="Study objectives in action"
        description="A living traceability matrix: every objective the study set out to prove, next to the evidence this system produces for it right now."
        meta={!loading && !error && <span className="text-xs font-semibold text-ink-muted">{scopeSentence(data?.scope)}</span>}
        actions={
          <Button variant="secondary" leftIcon={Printer} onClick={() => window.print()} className="objectives-no-print">
            Print
          </Button>
        }
      />

      {loading && (
        <div className="space-y-6" role="status" aria-label="Loading study objectives">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && error && (
        <Card>
          <ErrorState title="Study objectives could not be loaded" description="Check your connection and try again." onRetry={load} />
        </Card>
      )}

      {!loading && !error && objectives.length === 0 && (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No objectives are configured yet"
            description="Once the objectives catalog is set up, every study objective will appear here with its live evidence."
          />
        </Card>
      )}

      {!loading && !error && objectives.length > 0 && (
        <>
          <GeneralObjectiveBanner objective={grouped.general} />
          <ResearchFoundationSection so1={grouped.so1} so4={grouped.so4} />
          <So2PillarSystem objectives={grouped.so2} />
          <SynthesisSection objective={grouped.so3} />
        </>
      )}
    </div>
  );
}
