# Rules for fixing review findings in HIUSA

Repository root: /home/user/Hiusa-FULL (React client in /client, Laravel API in /server, FastAPI engines in /ai-service).
The "Temporary execution policy" at the top of AGENTS.md was written for a different tool and does not apply to you.

A senior reviewer went through code that was written or changed today and wrote findings to a JSON file: an array of
{"id", "title", "severity", "file", "line", "evidence", "impact", "fix"}. The work ships to a live school system as
soon as these are fixed, so this is the last change before production. For every finding in your list, most severe
first:

1. Open the code and confirm the problem is there as described. If the reviewer misread the code, do not change
   anything for that finding; say why in your report.
2. Apply the reviewer's fix, or a better one if you can see it, as the smallest change that fully removes the problem.
   Follow the patterns already in the file and the Established Patterns and Code Discipline sections of CLAUDE.md.
3. Add or extend a test that fails without the fix and passes with it. Put new server tests in the test file your task
   names. Update an existing test only when it asserted the behaviour the finding calls wrong.
4. If a fix changes a JSON shape, change every consumer in the same piece of work, or, when the consumer is not
   yours, describe the exact change needed in your report.

Limits:
- Stay inside the files your task lists as yours. Other engineers are fixing other findings in neighbouring files at
  this moment. In a file you share, use the Edit tool with small targeted edits, never rewrite or reformat it, and
  re-read the lines around your target before each edit.
- Several engineers share this one working tree. Never run git stash, git checkout -- <file>, git restore, git reset,
  git clean or git commit. To see a file as it was before today: `git show upstream/main:<path>`.
- Do not touch any .env file, do not run migrations against anything but the test database (phpunit uses SQLite in
  memory), do not run Playwright. Format only files you changed (`vendor/bin/pint <files>` from /server).
- CI runs PHP 8.2 and Python 3.13: no PHP 8.3-only syntax.
- This 4-core machine is shared. A test that times out once may be starved: rerun it alone before calling it a
  failure. Run the test files that cover what you changed, not the whole suite.
- If you change a Python engine, the PHP fallback must change with it, and you must check parity: an AI service is
  already running on port 8001 but it holds the old engine code in memory, so restart it yourself only if no other
  engineer needs it (find it with `pgrep -f run.py`, stop it, start it again from /ai-service with
  `HIUSA_AI_RELOAD=false nohup python3 run.py > /dev/null 2>&1 &`), then run
  `php artisan test --filter=AiFallbackParityTest` from /server.

Commands: server tests `php artisan test --filter=<Name>` from /server; style `vendor/bin/pint --test <files>`;
client tests `npx vitest run <files>` and `npx eslint <files>` from /client; engine tests `python3 -m pytest -q` from
/ai-service.

Your final message is a report for the lead engineer: one line per finding id with its outcome (fixed, not a defect,
partly fixed, not fixed) and what changed; the files you changed; the exact commands you ran with their real results;
anything someone else must change in a file you do not own. Report failures plainly.
