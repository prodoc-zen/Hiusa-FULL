# HIUSA UI Elevation Spec

Status: binding for all UI work from 2026-09-27. Sources: `design.md` and the project CLAUDE.md (pinned palette, Poppins, lucide), `PRODUCT.md`, the Phase 0 design audit, the impeccable craft floor, and Emil Kowalski's design engineering rules. Where this spec and `design.md` disagree, `design.md`'s pinned values win and this spec gets fixed.

Why this exists: the dean judged the UI "too plain, no soul, no emotion", and asked that the system visibly reflect the objectives of the study. The Phase 0 audit found the mechanism: one dark header band hand-copied across 20 files, stock Tailwind status colors in 224+ places, one of five dashboards greeting the user, two chart components wired into 2 of about 40 pages, bare-text empty states, and no motion or feedback system. This spec replaces those with a shared system that carries the brand in precise details.

## 1. Direction contract (development only, never shipped to the browser)

- THESIS: Every role opens HIUSA to a living briefing of its organization: what is happening across the six areas the study targets, what needs this person now, and what the AI noticed and why. It refuses the category default of four identical stat tiles over a gray table.
- OWN-WORLD: Deep navy structure (sidebar, briefing band), white working surfaces floating on the soft blue page, primary blue only for action and selection, electric cyan only for focus and live signals. A single faceted angle, taken from the logo's triangle, appears as a restrained motif on the dashboard briefing band and in empty-state illustrations. Crisp 1px borders, soft offset shadows, Poppins with tabular numerals for money and counts.
- STORY: A panelist opening any role sees, within one viewport, the six study areas alive with real data, the AI mechanisms explaining themselves, and a clear next action for that person.
- FIRST VIEWPORT: The briefing band ("Good morning, Maria", role, organization, date, a one-sentence summary written from live data), the attention list, and the six-area pulse, all above the fold at 1440x900; on 390px the greeting, the top three attention items, then the pulse.
- SIGNATURE INTERACTION: "Why?" on every AI output opens a disclosure showing the engine, its inputs and its formula (the paper's XAI promise), animated from the trigger.
- RISK: Over-decorating an operate surface. Brand lives in precise details; the task always wins.

## 2. Tokens (Tailwind 4 `@theme` in `client/src/index.css`)

Custom names avoid clashing with Tailwind's default palette. Use these utilities (`bg-navy-950`, `text-ink-muted`, `border-line`, and so on) instead of raw hex or stock palette classes.

| Token | Value | Use |
|---|---|---|
| `--color-navy-950` | #0B1831 | Sidebar, briefing band, auth brand panel |
| `--color-navy-800` | #0F2F62 | Secondary dark panels, chart primary series on light |
| `--color-brand-600` | #0B8ED0 | Non-text or large elements only: active nav indicator, icons, focus accents, charts, selection, large headings |
| `--color-brand-700` | #0878B7 | Default for primary buttons and text links (white on brand-700 is 4.79:1; white on brand-600 is 3.62:1 and fails AA for text) |
| `--color-brand-800` | #06659A | Primary button hover and pressed state (white on brand-800 is 6.30:1) |
| `--color-brand-100` | #CDE9F7 | Selected rows, text selection |
| `--color-brand-50` | #E7F4FB | Info tint, active nav background on light |
| `--color-accent` | #16C7F3 | Focus rings, live indicators, chart accent only |
| `--color-page` | #EEF6FB | App background |
| `--color-surface` | #FFFFFF | Cards, forms, modals, tables |
| `--color-subtle` | #F8FBFD | Table header, row hover, secondary panels |
| `--color-line` | #DDE7EF | Borders, dividers, input borders |
| `--color-line-soft` | #E5EDF3 | Table row borders |
| `--color-ink` | #0F172A | Titles, values, labels |
| `--color-ink-muted` | #64748B | Descriptions, helper text on white surfaces only (4.76:1 on `--color-surface`; only 4.35:1 on `--color-page`, which fails) |
| `--color-ink-muted-strong` | #475569 | Descriptions and helper text placed directly on `--color-page` (6.93:1 on page, 7.58:1 on surface), used by `PageHeader`'s description |
| `--color-ink-soft` | #94A3B8 | Placeholders, tertiary metadata (never body text) |
| `--color-success` / `-strong` / `-tint` | #16A34A / #15803D / #EBF7EF | Completed, approved, paid (success-strong on tint is 4.56:1; the prior tint #E8F6ED measured 4.499:1 and failed) |
| `--color-warning` / `-strong` / `-tint` | #F59E0B / #B45309 / #FEF3DB | Pending, review needed |
| `--color-danger` / `-strong` / `-tint` | #DC2626 / #B91C1C / #FBE9E9 | Destructive, failed, blocked |

Badge text always uses the `-strong` shade on the `-tint` background (the base hues fail 4.5:1 on tints).

### 2.1 Accessibility decision: brand-600 button text (orchestrator, 2026-09-27)

Measured: white text on `--color-brand-600` (#0B8ED0) is 3.62:1, failing WCAG AA (4.5:1) for normal-size text. Decision: `Button` and `IconButton` primary variants, and default text-link color, move to `--color-brand-700` (4.79:1) with `--color-brand-800` (6.30:1, new token) as the hover/pressed step. `--color-brand-600` remains the brand accent for everything that is not text or is large/decorative: the active nav indicator, standalone icons, focus rings and carets, chart series, selection highlights, and large headings, none of which carry the 4.5:1 text requirement.

Also measured: `PageHeader`'s description sits directly on `--color-page` (#EEF6FB), where `--color-ink-muted` is 4.35:1 and fails. Decision: introduce `--color-ink-muted-strong` (#475569, 6.93:1 on page) for muted text placed directly on the page background; keep `--color-ink-muted` for muted text inside white surfaces (cards, tables, modals), where it already passes at 4.76:1. `PageHeader`'s description also caps its measure at `max-w-[75ch]`.

- Radius: `--radius-control` 6px (inputs, buttons), `--radius-card` 8px (cards, modals), full for badges and avatars.
- Shadows (always offset plus soft blur, never a zero-offset halo): `--shadow-card` 0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06); `--shadow-raised` 0 12px 32px -8px rgb(11 24 49 / 0.20), 0 2px 6px rgb(11 24 49 / 0.06) for popovers, drawers, modals.
- Easing: `--ease-out` cubic-bezier(0.23, 1, 0.32, 1); `--ease-in-out` cubic-bezier(0.77, 0, 0.175, 1); `--ease-drawer` cubic-bezier(0.32, 0.72, 0, 1). Durations: 120ms press, 180ms popovers and route content, 240ms modals, 300ms drawers. Never `ease-in`, never `transition: all`.
- Type scale (fixed rem, operate surface): page title 28px/800, section title 20px/700, card title 16px/700, body 14px/500 (15px on reading surfaces), label 13px/600, helper and metadata 12px/500. Numbers in tables, money and counts use `tabular-nums`. No negative tracking. Uppercase only for badges and tabs.
- Browser surfaces are themed: `::selection` brand-100 background with ink text; `caret-color` brand-600; scrollbars thin in line and ink-soft; `:focus-visible` ring 3px accent at 35% plus brand border, never removed without replacement; links underline-offset 3px.

## 3. Component kit (`client/src/components/ui/`)

All components are keyboard operable, labelled, and ship every state: default, hover (gated behind `(hover: hover)`), focus-visible, active, disabled, loading, error.

- `Button`: variants primary, secondary, danger, ghost; sizes sm (36px), md (44px, default), lg; `loading` keeps width and shows a spinner with `aria-busy`; `leftIcon` and `rightIcon`; renders as a router `Link` when given `to`. Press feedback `scale(0.97)` 120ms.
- `IconButton`: required `label` becomes `aria-label` and tooltip. Touch target at least 42px.
- `Field` with `Input`, `Select`, `Textarea`: visible label above, hint, inline error with `aria-describedby`, required marker, 44px controls.
- `Card`: optional header (title, description, actions), body, footer. Never nest cards; use dividers inside.
- `PageHeader`: optional breadcrumbs, title, one-line description, actions (one primary), optional meta (status badge, updated time). Light surface, not the old navy band. No eyebrow or kicker above the title (craft floor ban).
- `StatusBadge`: a domain status key maps to tone plus human label via one shared map (`statusTones.js`) covering every status in the app (paid, pending, pending_payment, payment_submitted, verified, claimed, cancelled, approved, rejected, draft, submitted, under_review, voting, open, closed, published, planning, ongoing, completed, overdue, in_progress, active, disabled, and so on). Dot plus text, never color alone.
- `EmptyState`: three kinds. First-run: a composed lucide illustration (icon inside a soft brand-tinted faceted shape), a title that names the thing, one sentence on why it matters, a primary action. Filtered: "No results for 'x'" plus clear filters. Restricted: explains who can do this.
- `ErrorState`: names the problem and the recovery, with a "Try again" button.
- `Skeleton` family: `Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonTable`, `SkeletonStat`; a subtle shimmer that stops under reduced motion. Plain "Loading..." text is banned.
- `DataTable`: columns config, a styled table at md and up that becomes divided rows in the parent Card below md (never nested cards), optional sort with `aria-sort`, row actions on the right, a header sticky to the page, built-in loading, a neutral first-run empty state by default and the filtered state only when `filtersActive`, error states, slots for the existing `TableFilterBar` and `PaginationControls`. The desktop table does not wrap itself in its own horizontal scroll container: a `position: sticky` header inside an `overflow-x` wrapper sticks to that wrapper, not the page, in every current browser (measured), and the only fix that keeps page-relative stickiness with independent horizontal scroll is splitting header and body into separately scrolled, JS-synced elements, which breaks native `<table>` semantics for screen readers. Given DataTable's columns today, we keep one semantic table, drop the horizontal scroll, and let columns reflow at width; headers stay `whitespace-nowrap`. Revisit only if a table needs enough columns that reflow stops being readable.
- `Tabs` and `SegmentedControl`: accessible roving focus, an indicator that slides between tabs (transform, 180ms).
- `Drawer`: right-side sheet for record details and quick edits (preferred over a modal when the task does not need to block the page).
- Modals: keep the existing `Modal`, `ConfirmModal` and `AccessibleOverlay` APIs, restyle to the tokens, 240ms scale 0.97 to 1 plus fade, centered origin.
- Toasts: `sonner` mounted once, themed (not unstyled) so stacked toasts stay opaque; a `notify.success / error / info / warning / promise` helper; `FeedbackToast` keeps its API but delegates to it.
- `Avatar` (photo or initials with a deterministic brand tint) and `OrgMark` (organization logo or abbreviation).
- `Tooltip`, `Kbd`, `ProgressMeter` (labelled value against a limit, thresholds change tone at 80% and 100%), `Stat` (value, label, delta with direction and period, one-line context, optional link).

## 4. Data visualization (`client/src/components/charts/`)

Hand-built SVG, no chart dependency, consistent with the existing `DataDonutChart` and `FinancialForecastChart`. Every chart has a title, units, direct labels where possible, a keyboard-reachable tooltip, and a visually hidden table fallback. Series colors: navy-800, brand-600, accent, then success, warning. Charts appear only where the numbers tell a story (trend, composition, progress against a limit), never as decoration.

- `TrendChart` (line or area, actual versus forecast with a dashed forecast segment and a confidence band, used by the OLS forecast).
- `BarList` (ranked horizontal bars with labels and values).
- `Donut` (wraps the existing component).
- `StackedBar` and `Meter`.
- Formatting helpers in `client/src/lib/format.js`: `peso()` (₱1,234.50), `compactPeso()`, `number()`, `percent()`, `relativeTime()`, `manilaDate()` (Asia/Manila).

## 5. The six study areas (`client/src/lib/pillars.js`)

One config used by every dashboard and by the objectives page, so the study's structure is visible everywhere.

| Key | Label | lucide icon | Objective |
|---|---|---|---|
| finance | Financial management | Wallet | SO2.1 |
| events | Event management | CalendarDays | SO2.2 |
| tasks | Task management | ListChecks | SO2.3 |
| elections | Elections | Vote | SO2.4 |
| merchandise | Merchandise | ShoppingBag | SO2.5 |
| communication | Organizational communication | Megaphone | SO2.6 |

## 6. Dashboard pattern: the Briefing (`client/src/components/dashboard/`)

Fed by `GET /api/dashboard/briefing` (role-aware). Every role dashboard is built from these parts, in this order:

1. `BriefingHeader`: navy band with the faceted angle motif. "Good morning / afternoon / evening, {first name}" by Asia/Manila time, role and organization, today's date, and a one-sentence summary composed from live counts ("Two approvals and one closing election need you today." or "You're all caught up."). One or two primary actions on the right.
2. `AttentionList`: prioritized, actionable items (approvals waiting, elections closing, orders to verify, overdue tasks, reports due), each with severity, due time, and a deep link. Empty: a calm "You're all caught up" state.
3. `PillarPulse`: one panel holding the role-relevant areas, divided internally (not six separate cards), each with its icon, the headline number in context ("₱38,200 left of ₱60,000"), a delta with its period, and a mini meter or trend only when it adds meaning.
4. `AiInsightCard`s: "What HIUSA noticed", one to three insights from the deterministic engines (budget advisory risk, forecast trend, task workload balance, election turnout pace), each with the existing `ai/EngineBadge` and a "Why?" `ai/RulesDisclosure` showing inputs and formula. Wording is always advisory.
5. `AgendaList` (upcoming schedule) and `ActivityFeed` (recent accountable actions from the audit log).

Role emphasis:

- SUPER_ADMIN: university view. Organizations health table (organization, accreditation or compliance status, budget utilization, reports pending, last activity), cross-organization pulse, the approval queue, university announcements.
- ADMIN: the whole organization across all six areas.
- SBO_OFFICER: operations first: orders to verify, attendance today, my tasks, finance read-only.
- DEPARTMENT_HEAD: the decisions queue first, then the department's organizations' pulse, read-only.
- STUDENT (phone first): the active election (countdown and "Vote now", or "You voted" with a receipt), upcoming events with check-in status, my orders with claim tokens, announcements, my tasks.

## 7. Motion

Motion conveys state only. Content on route change fades in with an 8px rise over 180ms, once, with no orchestrated sequences. Button press scales to 0.97. Popovers and menus scale from their trigger at 0.97 with fade over 160ms. Modals 240ms; drawers 300ms on the drawer curve; toasts via sonner. One celebratory moment per success that matters (vote cast, order claimed, report approved): a drawn check over 400ms, once. Exits are faster than entrances. Under `prefers-reduced-motion`, drop all transforms and keep short opacity fades. Never animate keyboard-initiated or high-frequency actions.

## 8. Voice and microcopy

- Controls name their action: "Record transaction", "Approve budget", "Cast my vote", not "Submit" or "OK".
- Empty states say what the thing is, why it is empty, and what to do next.
- Errors say what went wrong and how to recover. Never show raw exception text.
- Confirmations name the consequence: "Delete this event? Its tasks and attendance records will be removed."
- Speak to people, warmly and plainly: "Your vote is in. Thank you for taking part." Money as ₱ with two decimals; dates relative with the absolute date in a tooltip; Asia/Manila time.

## 9. Page archetypes

- List pages: `PageHeader` (title, description, one primary action) above a `Card` holding `TableFilterBar`, `DataTable` and `PaginationControls`. Details open in a `Drawer`; create and edit use a `Modal` only when the task needs protected focus, otherwise an inline or drawer form.
- Detail pages: `PageHeader` with a status badge, a main column and a side column of facts, and a timeline of accountable actions.
- Forms: grouped fieldsets, a clear primary action at the end, inline validation, an unsaved-changes guard on long forms.
- Every page handles the universal states S-01..S-16 in `docs/USE_CASE_INVENTORY.md`.

## 10. Refused patterns (from the craft floor and design.md)

An eyebrow or kicker above a heading; the hand-copied navy header band on module pages; identical icon-heading-text card grids as page structure; nested cards; gradient text; glass as decoration; a colored left border thicker than 1px on cards or alerts; zero-offset glow; sparklines as filler; emoji or unicode as icons; stock Tailwind status palettes (red-50, amber-50, emerald-50) instead of the tokens; plain "Loading..." text; native `window.confirm` or `alert`; raw hex where a token exists.
