# Part 7 performance and verification follow-up

The organization register now requests `/api/system/agency?summary=1` for its tab counts. This optional SAO-only query returns the same `totals` as the full agency overview, using grouped organization counts and a college count. The existing full response remains unchanged when `summary` is absent or zero. Laravel rejects invalid summary values with its usual `422` validation response.

Opening the register loads the summary and the visible organization page. It no longer downloads an unused college catalog or every active organization. Parent organization options load when the edit dialog opens; their loading state, failure, and retry stay inside that dialog. An options failure therefore does not hide the register. Search still uses its existing debounce and response ordering guard.

The shared GET cache still deduplicates concurrent reads and reuses recent JSON responses. Clearing it after a successful write also invalidates outstanding reads, so an older response cannot refill the cache or absorb a fresh request. Token changes invalidate the same generation. Cancellable requests and binary downloads retain their independent transport behavior. Cached JSON is bounded to 75 entries, 1 MiB per response, and 5 MiB in total, measured in UTF-8 bytes. Least recently used entries are evicted first. Responses marked `no-store` are not retained, and callers receive independent data copies.

The deletion review also found older merchandise and payment images in `server/public/uploads`. A dedicated filesystem disk lets the durable cleanup journal remove these files after database commit. Shared references, URLs on outside hosts, and traversal paths are preserved. Reference checks stream rows and retain only matches to candidate files instead of loading every surviving file record into a PHP collection. Production deletion still requires SAO access and the exact selected name; deployment does not execute a deletion.

The repository now explicitly ignores `.worktrees/`, `*.pem`, and `*.key`. Credential content is never printed, copied into the checkout, or staged.

Anti Slop remains active during implementation. The existing Part 7 design stays in place. The new loading and retry messages describe an actual request; no decorative elements or new design system were introduced. Deterministic tests exercise the register, edit options, cache races, role boundaries, and file cleanup. Browser automation and subagents remain disabled under the user's repository policy.

## Validation

- `npm.cmd run test:unit`: PASS, 183 files and 1,963 tests. Existing jsdom document-navigation notices are non-failing.
- `php artisan test --stop-on-failure`: PASS, 1,023 passed, 6 skipped, 10,393 assertions.
- `npm.cmd run lint`, `npm.cmd run build`, targeted `php vendor/bin/pint --test`, and `git diff --check`: PASS. The existing large ExcelJS chunk warning remains.
- Primary-agent security and release review: completed directly for cache/session boundaries, API compatibility, SAO access, safe paths, shared files, and post-commit cleanup. Browser QA remains excluded by user policy.
- A read-only pre-deployment probe of the full agency controller on Lightsail returned 4,265 bytes using 12 queries. Timing samples are not a browser responsiveness benchmark.
