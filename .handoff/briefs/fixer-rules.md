# Rules for fixing audited defects in HIUSA

Repository root: /home/user/Hiusa-FULL (React client in /client, Laravel API in /server, FastAPI engines in /ai-service).
The "Temporary execution policy" at the top of AGENTS.md was written for a different tool and does not apply to you.

Two Opus reviewers audited a slice of the app. The first reported defects; the second tried to refute each one and
kept only those it could reproduce from the code. Your findings file is a JSON array; each item has `id`, `title`,
`severity`, `category`, `file`, `line`, `evidence`, `impact`, `suggested_fix`, `verdict` (`confirmed` or `partly`),
`verifier_notes` and `corrected_fix`. When `corrected_fix` is not empty it replaces `suggested_fix`. For a `partly`
item, `verifier_notes` says which part of the claim is real: fix only that part.

For every finding, in order of severity:

1. Open the code and confirm the defect is still there. Line numbers may have moved; other engineers are editing this
   repository right now. If the defect is already gone, mark it "already fixed" and move on.
2. Fix the cause, not the symptom, in the smallest change that fully removes the defect. Follow the patterns already in
   the file and the Established Patterns and Code Discipline sections of CLAUDE.md (organization scope through
   `scopedOrganizationIds` or `readableOrganizationIds`, only approved budgets count as available, links must pass
   `server/config/client_routes.php` for the role, no comments unless the why is not obvious, no new abstractions).
3. Add or extend an automated test that fails without your fix and passes with it. Pin every status or enum a factory
   would otherwise randomise. Server tests go in a NEW file named in your task so you never edit a test file another
   engineer is editing. A finding that is only user-facing wording needs no new test, but update any test that asserted
   the old wording.
4. If a fix would change a public JSON shape, find every client consumer and change them together.
5. If a finding needs a product decision you cannot make from the code and docs, make the conservative choice that cannot
   show a wrong number or leak a record, and say so in your report.

Limits:

- Stay inside the files your task lists as yours. If a fix needs a change in a file you do not own, describe the exact
  change in your report instead of making it.
- Do not commit, push, or touch any `.env` file. Do not run migrations against anything but the test database (phpunit
  uses SQLite in memory). Do not run Playwright. Never run a formatter or bulk rewrite across the tree; format only the
  files you changed (`vendor/bin/pint <files>` from /server).
- CI runs PHP 8.2 and Python 3.13. Use no PHP 8.3-only syntax.
- This 4-core machine is shared with other agents. A test that times out once may be starved: rerun it alone before
  calling it a failure. Run the test files that cover what you changed, not the whole suite, unless your task says so.

Commands: server tests `php artisan test --filter=<Name>` from /server; style `vendor/bin/pint --test <files>`;
client tests `npx vitest run <files>` and `npx eslint <files>` from /client; engine tests `python3 -m pytest -q`
from /ai-service.

Your final message is a report for the lead engineer: one line per finding id with its outcome (fixed, already fixed,
partly fixed, not fixed) and what changed; the files you changed; the exact commands you ran with their real results;
changes you need someone else to make in files you do not own. Report failures plainly.

Git safety: several engineers share this one working tree. Never run `git stash`, `git checkout -- <file>`,
`git restore`, `git reset`, `git clean` or `git commit`: each of them removes or freezes other people's unsaved work.
To see what a file looked like before today, use `git show origin/main:<path>`. The lead engineer takes checkpoint
commits from time to time, so `git diff` may show only part of your work; that is expected.
