# HIUSA Ask AI release: continue and ship

You are picking up a release that another session built over one long day. Nearly all of it is written and reviewed.
Your job is to finish the last fixes, verify everything, and get it to the owner (Jade, GitHub `Jadehaerys`) as a
pull request they can merge and deploy from their phone. They want it live as soon as it is safe.

## Where the work is

- Code: branch `claude/ask-ai-page-revamp-l7e4bj` on the fork `Jadehaerys/hiusa-full-fork`.
- It targets `main` of `prodoc-zen/Hiusa-FULL` (last commit there when this started: `a65d89b`).
- `prodoc-zen` is a personal GitHub account that Jade does not own, so the Claude GitHub App cannot push or open pull
  requests there. Push only to the fork. In the working copy keep `origin` = the fork and `upstream` = prodoc-zen:
  `git remote set-url origin https://github.com/Jadehaerys/hiusa-full-fork` (a worker restart resets it).
- This folder, `.handoff/`, holds what the code alone does not say: the two contracts (`askai-contract.md`,
  `askai-actions-contract.md`), what each role needs and what the dean asked for (`research-roles.md`), every Opus
  review (`review/*.json`) and audit (`audit/*.confirmed.json`), the rules given to fixers and reviewers
  (`briefs/`), and helper scripts (`tools/`). **Delete `.handoff/` in the last commit before the pull request.**

## What was built (all on the branch)

1. Ask AI is now a conversation: streamed answers with a "thought for N seconds" summary, rich Markdown with a small
   safe set of HTML components, saved conversations (rename, delete, search), saved memories, copy, regenerate and
   feedback. Every number in an answer is checked against the person's records before it is shown; with no model
   configured every answer still works from the records.
2. Ask AI understands requests to do something ("I wanna create an org") and, per the owner's decision, carries
   actions out: it replies with an editable action card and runs the action through the normal endpoint when the
   person presses the card's button.
3. About 150 audited defects fixed across the AI features (Ask AI answers and routing, forecasts and budget advice,
   task delegation, event planning, grievance classification, dashboard insights, announcement drafts).
4. A new student page "Where your fees go" (figures from SAO-approved financial reports only).
5. A sweep that removed or shortened 32 pieces of unneeded text across the app.
6. `server/composer.lock` moved to Laravel 12.72.0, because `composer audit` (a CI step) fails on 12.69.3 since an
   advisory of 2026-11-13. `server/vendor` may still hold the old version: run `composer install` first.

## Latest state (updated by the last session as it ran)

- Done and independently rechecked: chat client fixes, chat security fixes, model layer, finance, tasks and events,
  grievances/dashboard/announcements, the whole-change-set fixes, twelve of the Ask AI service findings, request
  understanding, the action card (client) and the server side of actions (8 actions, live-probed; its recheck is in
  `actions-server-recheck.json`: the one serious problem is that `invite_department_head` stores the single-use
  invitation link in plain text in the chat message; show it in the confirm response only and never store it).
- Were running when the last session ended: chat server fixes (`review/chat-server.json` plus the OfficeStaffParity
  route list and the provider time budget), the routing fixes (ask-02 to 05, ask-11, ask-16 and the live problems),
  the small client pass (`review/client-pass.json`), and the Opus security review of actions (its findings go to
  `review/actions.json`). Check each in the tree before redoing it.

## What is left, in order

1. **See what the last session left mid-flight.** Three jobs were still running when it ended and may be finished,
   half finished or absent in the tree: fixes for `review/chat-server.json` (all 13), fixes for
   `review/whole-diff.json` (all-02 to all-08), and the independent recheck of the server side of actions
   (`AskAiActions*`, `AskAiActionController.php`, `AskAiActionsTest.php`: built, not yet probed live). For each
   finding, check the code and its test; finish what is missing. `open-items-from-rechecks.json` in this folder lists
   what the independent rechecks of the finished jobs still flagged; the largest set is routing: ten problems and
   thirteen failed live questions from the request-understanding work (for example "what do I owe" answered with the
   organization budget for staff roles, "open election" treated as a question, guide titles written for one role
   shown to another).
2. **Not started:** the routing findings in `review/askai-service.json` (ask-02, 03, 04, 05, 11) together with the
   routing problems in `open-items-from-rechecks.json`, with tests that assert the answer and not only the intent
   (the other twelve findings of that review are fixed and rechecked; ask-16 is partly done: the how-to methods still
   resolve links for the authorizing role instead of the profile role). A small client pass: a required select in the action card needs an
   empty first choice; the briefing links on the new-chat screen must go through `isSafePageHref`; the action card's
   checkbox help needs `aria-describedby`; an assistant message with a null payload must render; a 429 from the chat
   shows its message and does not retry; if the server added paging to the conversation list, use it. The
   "what can you do?" answer should list the actions the role can use.
3. **One Opus review of the actions feature**, server and client together, security first: it is the only part that
   writes records. Fix what it finds.
4. **Verify on a quiet machine** (see Environment): `composer install`, then from `/server`
   `php artisan test`, `vendor/bin/pint --test`, `composer audit`; from `/client` `npm run lint`,
   `npm run test:unit`, `npm run build`; from the root the three `node --test scripts/*.test.mjs` files CI runs; from
   `/ai-service` `python3 -m pytest -q`; `migrate:fresh --seed` plus rollback and forward of the newest migration on
   MySQL 8.4 and MariaDB 10.4; then the end-to-end suite in the order `.github/workflows/tests.yml` runs it. A red
   end-to-end job blocks the deploy. Drive the chat in a real browser at 1440 and 390 wide as an Admin and a student,
   with and without the stand-in model, and carry out one action end to end.
5. **Ship.** Delete `.handoff/`. Commit (author `Jadehaerys <jmykelvenz@gmail.com>`, trailer
   `Co-Authored-By: John Carlo Borgueta <johncarloborgueta@gmail.com>`, prefixes `feat:` `fix:` `chore:`, no AI
   attribution of any kind). Push to the fork. Then give Jade exactly these steps:
   - Open `https://github.com/prodoc-zen/Hiusa-FULL/compare/main...Jadehaerys:hiusa-full-fork:claude/ask-ai-page-revamp-l7e4bj?expand=1`,
     tap **Create pull request**, wait for the checks, tap **Merge**.
   - When the checks on `main` are green: Lightsail console, the instance, **Connect using SSH**, and paste
     `cd /var/www/hiusa && git fetch origin main && git show origin/main:scripts/deploy-lightsail.sh | tr -d '\r' | bash -s -- $(git rev-parse origin/main)`
   The automatic Deploy workflow is broken (its `DEPLOY_SSH_KEY` secret is not a valid key, and only the prodoc-zen
   account can change it), and this cloud environment has no network route to the server, so the browser terminal is
   the deploy path. The script backs up the database and uploads first and rolls the code back if it fails before
   migrating. Two new migrations run: the Ask AI conversation tables and the grievance classification correction.

## Rules that are already settled

- The owner's routing: Sonnet agents build and fix, Opus agents review. Never let a review finding be marked fixed
  without its code and a test; have a second agent re-run the tests.
- The assistant never shows a number that is not in the facts, never follows instructions found in record text, and
  runs an action only when the signed-in person presses the button on a card proposed for a message they typed.
- Everything in the project's `CLAUDE.md` applies: Poppins and the exact palette, no nested cards, client routes
  registered in `App.jsx`, `server/config/client_routes.php`, `pageMeta.js` and `navigation.js` together, the PHP and
  Python engines changed together with `AiFallbackParityTest` run against a restarted AI service.
- Never commit or use the Lightsail key the owner uploaded to the earlier session, and never run a reseed.

## Environment notes that cost time the first time

- This cloud machine has 4 CPUs and a Workflow runs only 2 agents at once: start several small workflows, or
  background agents, to work in parallel. Opus usage has a 5-hour limit; spend it on reviews only.
- `composer install` is slow the first time (about 25 minutes: package downloads fall back to git clones through the
  proxy). `npm ci` is quick. Start both before anything else.
- Docker works after starting the daemon by hand (`dockerd &`); run `mysql:8.4` on 3306 and `mariadb:10.4` on 3307
  with root/root and database `hiusa_db`. `server/.env`: copy `.env.example`, `php artisan key:generate`, point it at
  MySQL, set `FRONTEND_URL=http://127.0.0.1:5173`, raise the four `RATE_LIMIT_*` values to 600 as CI does, set
  `HIUSA_AI_SERVICE_KEY` to match `ai-service/.env`. With that `.env`, run phpunit as
  `FRONTEND_URL=http://localhost:5173 php artisan test` (two CORS tests expect localhost).
- Playwright: the project pins 1.62.1 and the installed browser is newer, so run specs with the wrapper config in
  `tools/pw.config.mjs` (it sets `executablePath: '/opt/pw-browsers/chromium'`; fix its output path first).
  `tools/shot.cjs` signs in as a seeded account and screenshots the chat. `tools/fake-anthropic.cjs` is a local
  stand-in for the model on port 8787: start a second API with
  `ANTHROPIC_API_KEY=local-test ANTHROPIC_BASE_URL=http://127.0.0.1:8787 AI_PROVIDER=anthropic` to see streamed,
  model-written answers; a question containing "invent" makes it state numbers the guard must reject.
- Seeded sign-ins (School ID / password): SAO 990001 / Admin@123456; dean 940001, organization head 900001,
  officer 900004, student 2100142, all Demo@12345.
- Tests that time out while many agents run are usually starved: rerun the file alone before believing it.
- A stop hook asks for a commit and push whenever the tree is dirty; checkpoint commits to the fork are fine.
