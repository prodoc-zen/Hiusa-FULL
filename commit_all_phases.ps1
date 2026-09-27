# ==============================================================================
# HIUSA V2 — Commit and Push Each Phase
# Run this script in PowerShell from c:\BSIT\React\Hiusa-FULL:
#   .\commit_all_phases.ps1
# ==============================================================================

Write-Host ">>> Starting phase-by-phase commits for HIUSA V2..." -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# Phase 1: Infrastructure, Utilities, Services, Biometric Hooks & Shared Components
# ------------------------------------------------------------------------------
Write-Host "`n>>> [1/7] Committing Phase 1: Infrastructure, Shared Components & Services..." -ForegroundColor Yellow
git add hiusa-v2/src/utils/ `
        hiusa-v2/src/services/ `
        hiusa-v2/src/components/FeedbackToast.tsx `
        hiusa-v2/src/components/PaginationControls.tsx `
        hiusa-v2/src/components/EngineBadge.tsx `
        hiusa-v2/src/components/RulesDisclosure.tsx `
        hiusa-v2/src/components/ScannerStatus.tsx `
        hiusa-v2/src/components/feed/ `
        hiusa-v2/src/components/Modal.tsx `
        hiusa-v2/src/hooks/useFingerprintReader.ts
git commit -m "feat(hiusa-v2): port core utils, services, shared components, and biometric hooks (Phase 1)"

# ------------------------------------------------------------------------------
# Phase 2: Elections Module
# ------------------------------------------------------------------------------
Write-Host "`n>>> [2/7] Committing Phase 2: Elections Module..." -ForegroundColor Yellow
git add hiusa-v2/src/components/elections/ `
        "hiusa-v2/src/app/(dashboard)/elections/"
git commit -m "feat(hiusa-v2): port elections hub, management, voting flow, and results (Phase 2)"

# ------------------------------------------------------------------------------
# Phase 3: Finance Module
# ------------------------------------------------------------------------------
Write-Host "`n>>> [3/7] Committing Phase 3: Finance Module..." -ForegroundColor Yellow
git add hiusa-v2/src/components/finance/ `
        hiusa-v2/src/services/financeService.ts `
        "hiusa-v2/src/app/(dashboard)/finance/"
git commit -m "feat(hiusa-v2): port 7-tab financial management, forecasting engine, and accounts (Phase 3)"

# ------------------------------------------------------------------------------
# Phase 4: Events & Attendance Module
# ------------------------------------------------------------------------------
Write-Host "`n>>> [4/7] Committing Phase 4: Events & Attendance Module..." -ForegroundColor Yellow
git add hiusa-v2/src/components/events/ `
        hiusa-v2/src/services/eventService.ts `
        hiusa-v2/src/services/fingerprintService.ts `
        "hiusa-v2/src/app/(dashboard)/events/"
git commit -m "feat(hiusa-v2): port activity calendar, event operations, and biometric check-in (Phase 4)"

# ------------------------------------------------------------------------------
# Phase 5: Merchandise & Orders Module
# ------------------------------------------------------------------------------
Write-Host "`n>>> [5/7] Committing Phase 5: Merchandise & Orders Module..." -ForegroundColor Yellow
git add hiusa-v2/src/components/merchandise/ `
        hiusa-v2/src/services/merchandiseService.ts `
        hiusa-v2/src/services/orderService.ts `
        "hiusa-v2/src/app/(dashboard)/merchandise/" `
        "hiusa-v2/src/app/(dashboard)/orders/"
git commit -m "feat(hiusa-v2): port merchandise store, GCash settings, order tracking, and token validator (Phase 5)"

# ------------------------------------------------------------------------------
# Phase 6: Admin, Tasks, Announcements & Approvals Module
# ------------------------------------------------------------------------------
Write-Host "`n>>> [6/7] Committing Phase 6: Admin, Tasks, Announcements & Approvals..." -ForegroundColor Yellow
git add hiusa-v2/src/components/users/ `
        hiusa-v2/src/components/audit/ `
        hiusa-v2/src/components/tasks/ `
        hiusa-v2/src/components/announcements/ `
        hiusa-v2/src/components/approvals/ `
        "hiusa-v2/src/app/(dashboard)/users/" `
        "hiusa-v2/src/app/(dashboard)/audit/" `
        "hiusa-v2/src/app/(dashboard)/tasks/" `
        "hiusa-v2/src/app/(dashboard)/announcements/" `
        "hiusa-v2/src/app/(dashboard)/approvals/"
git commit -m "feat(hiusa-v2): port user dock, academic structure, audit logs, tasks board, announcements, and approvals (Phase 6)"

# ------------------------------------------------------------------------------
# Phase 7: Layout, Routing, Dashboards & Auth Flow
# ------------------------------------------------------------------------------
Write-Host "`n>>> [7/7] Committing Phase 7: Layout, Routing, Dashboards & Auth Flow..." -ForegroundColor Yellow
git add hiusa-v2/src/components/layout/ `
        hiusa-v2/src/components/settings/ `
        "hiusa-v2/src/app/(dashboard)/dashboard/" `
        "hiusa-v2/src/app/(dashboard)/layout.tsx" `
        "hiusa-v2/src/app/(dashboard)/settings/" `
        "hiusa-v2/src/app/(dashboard)/profile/" `
        "hiusa-v2/src/app/(dashboard)/student-feed/" `
        "hiusa-v2/src/app/(auth)/" `
        hiusa-v2/src/app/page.tsx `
        hiusa-v2/next.config.ts
git commit -m "feat(hiusa-v2): port TopBar, Sidebar, role dashboards, auth flows, and route rewrites (Phase 7)"

# ------------------------------------------------------------------------------
# Any remaining changes (e.g. public assets, root config, docs)
# ------------------------------------------------------------------------------
Write-Host "`n>>> Committing any remaining project assets..." -ForegroundColor Yellow
git add hiusa-v2/public/ `
        hiusa-v2/package.json `
        commit_all_phases.ps1
git commit -m "chore(hiusa-v2): complete 1:1 parity migration across all modules" --allow-empty

# ------------------------------------------------------------------------------
# Push
# ------------------------------------------------------------------------------
Write-Host "`n>>> Pushing all commits to remote repository..." -ForegroundColor Cyan
git push

Write-Host "`nAll phases successfully committed and pushed!" -ForegroundColor Green
