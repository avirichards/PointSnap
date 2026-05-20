## Superpowers — Invoke First (DO THIS BEFORE ANY OTHER RESPONSE)

At the very start of every session, before responding to the user or running any other tool, invoke the `using-superpowers` skill via the `Skill` tool. That skill establishes how to discover and use the 14+ Superpowers skills (`brainstorming`, `systematic-debugging`, `test-driven-development`, `writing-plans`, `executing-plans`, `verification-before-completion`, etc.) installed under `.claude/skills/`.

This is mandatory and non-optional — it is the primary mechanism that gives Claude its Superpowers. If a SessionStart hook has already injected the same content, you can skip the tool call; otherwise, invoke it before doing anything else.

---

## UI / UX Design — Always Use the Apple HIG Skill

**Whenever the task touches user-visible design** — building or modifying a page, component, layout, color scheme, typography, spacing, navigation pattern, form, table, mobile breakpoint, dark mode, motion, or accessibility behavior — invoke the `apple-hig` skill via the `Skill` tool **before writing the code**. This applies to web (Next.js / Tailwind / shadcn), responsive layouts, the spreadsheet, the search form, the wallet, the admin shell, and any future mobile app surface.

The skill is "universal design expert grounded in Apple's HIG philosophy" — it covers any platform, not just iOS. Use it as the design lens for every PointSnap surface so the cockpit feels considered, dense-but-clear, and consistent. Apply HIG patterns even when ultimately styling with Tailwind/shadcn — the spacing rhythm, typographic hierarchy, color semantics, accessibility expectations, and interaction affordances all translate.

Don't skip it for "small" UI changes. A badge color, a row-height tweak, a hover affordance — all benefit from the HIG check. The Phase 1 spreadsheet view especially deserves the audit since it's the marquee surface.

---

## Git & Deployment Workflow (CRITICAL — READ FIRST)

**This app is in production with live users. Protect the live site at all costs.**

### Branch structure

- **`main`** — production. Vercel auto-deploys this branch to the live site. **Never push directly to `main`** (except on explicit "this is urgent" trigger).
- **`claude/<slug>`** / **`feat/<topic>`** / **`fix/<topic>`** — long-running or per-workstream working branches. Vercel previews every pushed branch automatically, so the feature branch itself serves as staging. Kebab-case, short but specific.

There is **no `dev` branch** in this repo. The project is small, single-operator, and pre-real-user, so the simpler `feature branch → main` flow is enough. If a separate staging branch ever becomes useful (multi-developer phase, real-user phase), revisit this section then — don't preemptively reintroduce it.

**Never commit directly to `main`, or to someone else's working branch.**

Flow:
1. Session starts → confirm/create the working branch. Default is to reuse the existing long-running working branch (which is normal for this project). Only create a new one when the user explicitly starts a separate workstream.
2. Commit frequently as you work (after each logical milestone). Uncommitted work is fragile across tool restarts.
3. When the user says **"push it"** → push the working branch. Vercel previews it automatically — share the preview URL.
4. When the user says **"go live" / "push it live" / "merge to main"** → fast-forward (or merge) the working branch into `main`, push `main`. Vercel auto-deploys production.
5. After a merge to main, ask the user whether the working branch should keep running for follow-up work or be deleted.

### Working branch hygiene

The default working model is **one long-running working branch + occasional merges to main on explicit trigger**, not a fresh branch per Claude conversation. Commits accumulate on the working branch; the branch lives across many conversations.

If multiple Claude conversations ever run against the same repo at once, switch to **worktree-per-conversation** (use `git worktree add` to give each conversation its own working directory + branch) — because two conversations sharing one working directory will fight over branch checkouts and lose work. With one conversation at a time (the current reality), a single working directory + single long-running working branch is fine.

**At the start of any session that will touch code:**
1. **Audit stale branches.** Run `git branch -a --no-merged main` to see what's hanging around. Surface unmerged branches to the user: *"N branches with unmerged work: X (N commits ahead), Y (N commits ahead). Want to land any before we start?"* Don't silently start fresh work on top of a graveyard — stale branches compound over time.
2. **Confirm which working branch to use.** Almost always the existing long-running one. If the user is clearly starting a separate workstream (e.g. a hotfix while a feature is in flight), create a new one.

**At the end of a workstream (not necessarily end of conversation):**
1. Commit every change before stopping.
2. Ask the user to pick an outcome: merge to `main` (complete + ready to ship), keep running (more work coming), or delete (dead end / abandoned).

**Exceptions** (no branch ceremony needed):
- Read-only conversations (answering questions, searching code).
- Database-only work that doesn't modify source files.
- Trivial single-file fixes the user explicitly requests against a named branch.

When in doubt, ask the user.

### When the user says "push it to GitHub" or "push it":
1. Push the **current working branch**. Vercel previews every pushed branch — share the preview URL.
2. Do not merge to `main` unless the user explicitly says so.

### When the user says "push it live", "go live", or "merge to main":
1. Fast-forward (or merge with `--no-ff` if non-FF) the working branch into `main`, push `main`.
2. Vercel automatically deploys to the live production site.
3. Ask the user whether to keep the working branch alive for follow-up work or delete it.

### When the user says "this is urgent, push straight to production":
1. This is the ONLY time you commit directly on `main`.
2. Confirm with the user before doing it.

### Database migrations — GitHub-integrated auto-apply on Supabase

**User-facing rule:** the user says what they want changed; Claude writes the migration file; pushing it to GitHub deploys it.

We use **Supabase's GitHub integration** (enabled when the project was created). The repo is connected to the Supabase project, and Supabase watches `supabase/migrations/`. On push:
- **Preview branch**: pushing a migration to any non-`main` branch causes Supabase to spin up a preview database branch with the migration applied. That preview DB's URL can be wired into Vercel preview env vars for end-to-end testing before merge.
- **Production apply**: merging to `main` causes Supabase to apply the migration to the production database.

This replaces the old "Claude applies via Management API + records in tracking table" flow. The drift incident on the previous project came from MIXING manual and CI migration paths. We now use exactly one path: **committed migration files via GitHub integration**, never manual SQL editor changes, never raw API DDL.

**When a schema change is needed, Claude must:**

1. **Write the file** at `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql`. Use a full **14-digit UTC timestamp** prefix (e.g. `20260418213055_add_foo_column.sql`), not an 8-digit date. Matches Supabase CLI convention.
2. **Write the SQL idempotently.** `CREATE OR REPLACE` for functions, `CREATE ... IF NOT EXISTS` for tables/indexes/types/policies, `DROP ... IF EXISTS` for removals. End each migration with `NOTIFY pgrst, 'reload schema';` if it changes anything PostgREST exposes.
3. **Commit** the `.sql` file to the current feature branch with a descriptive `fix(db):` / `feat(db):` message. Do **not** bundle schema commits with unrelated code changes — schema commits are the unit Supabase applies.
4. **Push** the branch. Supabase auto-creates a preview DB branch with the migration applied. Surface the preview branch URL/anon key to the user so they can paste into Vercel preview env vars if the frontend needs the new schema.
5. **Verify** by querying the preview branch via psycopg/postgres-js against the preview connection string (or, once configured, the Supabase MCP server). Catch FK/constraint/RLS failures here before they hit production.
6. **Merge to main** only on explicit user trigger (`merge to main`, `push it live`). Supabase auto-applies the migration to production on merge. Watch the Supabase dashboard's "Branches" tab to confirm the merge applied cleanly.

**Things Claude must NEVER do** (would recreate the past drift):
- Apply DDL via the Supabase SQL editor in the dashboard.
- POST DDL to the Management API's `/database/query` endpoint outside of a committed migration file.
- Manually insert/delete rows in `supabase_migrations.schema_migrations` — Supabase manages that table now.
- Hand-rewrite the contents of an already-applied migration file. If a migration is wrong, write a NEW migration that fixes it forward.

**Seed data + verification queries** are explicitly exempt from this — they don't change schema. Run `pnpm db:seed` ad-hoc, query the DB ad-hoc via psycopg/postgres-js/MCP — all fine, no commits required.

### Database branches — Supabase auto-creates them per Git branch

Supabase's GitHub integration handles branching automatically: every Git branch that contains changes in `supabase/migrations/` gets its own preview database with the new schema applied. No manual branch creation required.

**What this changes operationally:**
- Don't call `POST /v1/projects/<ref>/branches` manually — Supabase creates branches when migrations are pushed.
- The preview branch's connection string + anon key are visible in the Supabase dashboard under **Branches**. Read them from there to share with the user.
- Branches auto-delete when the Git branch is deleted/merged, so no manual cleanup billing risk.
- For multi-step DB work, each commit on the feature branch updates the same preview DB — exactly like Vercel preview deploys.

**Rollback safety still applies to every migration:**
- The migration SQL itself, idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`).
- A matching rollback SQL at `supabase/rollbacks/<same-prefix>_rollback.sql` that drops what the migration added.
- For destructive migrations, capture backup tables (`CREATE TABLE pointsnap_backup_YYYYMMDD__foo AS SELECT …`) inside the same migration, BEFORE the delete, so the rollback can re-insert.
- For anything touching existing production rows, capture a JSON snapshot to `scripts/<feature>-pre-migration-snapshot.json` and commit it before starting.

**Other constraints:**
- **Prefer additive changes** (new columns, new tables) over destructive ones. Split "add new thing" and "remove old thing" into two separate migrations applied in two separate sessions — the gap between them is the verification window.
- If a migration must drop or rename existing user-visible data, pause and explicitly confirm with the user before committing, even in auto mode.
- The Supabase MCP server (when configured per session) is the preferred way to inspect schema, run verification queries, and view branch status. Falls back to psycopg/postgres-js using the connection string in `.env.local`.

---

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy — Use Aggressively

- **Default to subagents** for any research, exploration, file reading, or analysis task
- The core engine files are large (44KB parser, 41KB engine) — never read these into the main context unless actively editing them
- Launch multiple subagents in parallel when exploring different areas of the codebase
- Use subagents for: migration analysis, code review, pattern search, dependency tracing, test verification
- Keep the main context window clean for decision-making and code generation
- One focused task per subagent — don't overload a single agent with multiple unrelated questions

### 3. Self-Improvement Loop

- After ANY correction from the user: update 'tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to 'tasks/todo.md' with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to 'tasks/todo.md'
6. **Capture Lessons**: Update 'tasks/lessons.md' after corrections

### 7. UI Element Pre-Implementation Checklist

Before writing any UI element — dropdown, popover, form input, table row, modal, button, badge, tooltip, or anything visible — stop and answer these questions BEFORE touching the keyboard:

**Positioning & Overflow**
- What is the full ancestor chain of this element? Does any ancestor have `overflow: hidden/auto/scroll`? If yes, `position: absolute` will be clipped — use a portal.
- If using a portal: use `position: fixed` + `getBoundingClientRect()` at click time, and a full-screen backdrop div for outside-click dismissal. Never use ref-based `mousedown` listeners with portals — ref timing is unreliable.

**Interaction Model**
- What events does this element respond to? Trace the full event sequence (mousedown → mouseup → click → change) and verify nothing in the chain closes/resets the element prematurely.
- If the element is inside a scroll container, modal, or table: does scrolling or tab switching break its position or state?

**State Correctness**
- Is state controlled or uncontrolled? If controlled, verify the value flows correctly through every re-render.
- Does resetting or switching context (tab change, cancel, save) clean up this element's state completely?

**Before Writing Code**
- Mentally simulate: open it, interact with it, close it, reopen it. Does it work correctly in all three phases?
- Ask: "What is the worst-case DOM context this element could live in?" Design for that, not the happy path.
- The zone dropdown took 3 broken attempts because none of these questions were asked before the first line of code. One attempt is the standard. Design it right the first time.

### 8. Carrier Domain Knowledge Standard

This tool reverse-engineers UPS/FedEx contracts from invoice data. The engine must be correct by carrier standards, not just by what the user describes.

**Always verify against real carrier behavior:**
- Cross-check contract structures against UPS Rate and Service Guide, actual UPS offer PDFs, and known carrier practices
- The user provides business context; Claude provides carrier technical accuracy — both are needed
- When a user describes a contract feature, confirm it against known UPS/FedEx patterns before implementing
- If a described behavior seems unusual, note it and verify (e.g., "additive" vs. "standalone" tier discounts)

**Known UPS contract structures to keep current on:**
- Tier incentives based on weekly rolling average spend (additive on top of service incentives)
- Weight + zone matrix discounts (common in Ground; discount varies by both lb band and zone group)
- Per-service DIM divisors (e.g., Air=194, Ground=225, Export=166 in real contracts)
- Ground Saver (SurePost) cubic inch threshold exemptions (e.g., packages ≤1,729 in³ billed actual weight)
- Minimum charges defined as % off published 1-lb rate at a reference zone (not flat dollar amounts)
- Electronic PLD bonus (often baked into published tier discounts, not separate)
- Accessorial discounts negotiated per service category (Ground vs Air can have different rates for same surcharge)
- Fuel surcharge discounts may apply to ground only, not air, depending on contract

### 9. Adding a New Page — One Manifest

All permission-controlled pages are registered in a single file: `src/config/pages.tsx`. That file is read by `App.tsx` (to emit `<Route>`s), `src/components/layout/Sidebar.tsx` (for nav items), `src/hooks/usePermissions.tsx` (`ALL_PAGE_SLUGS`), and `src/components/admin/PermissionsTab.tsx` (slug → label).

When you add a new user-facing page:
1. **Add one entry to `PAGES` in `src/config/pages.tsx`** — slug, path, label, icon, element, and where it should appear in the sidebar (`"main"`, `"footer"`, or `"none"`).
2. **Do not modify** `App.tsx`, `Sidebar.tsx`, `usePermissions.tsx`, or `PermissionsTab.tsx` to add the page — they already read from the manifest.
3. If the page has an alias path (e.g. `/` → `/dashboard`), list it in `aliasPaths`.
4. If the page bundle is large (>~500 KB — think Leaflet, heavy chart libs), use `lazy()` for its import inside `pages.tsx` and wrap the element in `<Suspense>`.

If you find yourself touching two or more of those four files to register a page, you've missed the manifest — stop and add the entry instead.

### 10. Knowledge Base — Draft, Don't Auto-Publish

Whenever a change touches the user-visible surface (new page, new feature, changed behavior, renamed/removed feature), **also draft a KB update** alongside the code change:

1. Create or edit a file under `tasks/kb-drafts/<slug>.md` describing what changed and why, written for a non-engineer user of the tool.
2. At the end of your PR summary to the user, list every draft created/updated and **prompt them to review** — do not publish to `src/lib/knowledgeBaseContent.ts` (or equivalent) automatically. KB articles need editorial judgment that diffs lack.
3. If the change is purely internal (refactor, test-only, infra), skip the draft.

The goal: when the user eventually asks "update the KB," every recent change already has a draft ready to polish and publish.

### 11. Post-Implementation Verification — Required Final Plan Step

Every non-trivial plan must end with a **Verification phase** that Claude executes after the implementation phases land. Non-trivial = any of: new DB migration, new trigger/RPC/edge function, new notification event, UI surfaces touched on 3+ pages, new external integration, or anything the user describes as "a big feature."

The Verification phase is four ordered steps. Do not skip, re-order, or collapse them.

**1. Fresh-eyes code audit.** Re-read every file the feature created or modified as if you'd never seen the code before. Look specifically for:
- Edge cases the plan didn't anticipate (null/empty state, partial failures, race conditions)
- Hardcoded values that should be derived from hook/DB/config
- RLS policies, partial unique indexes, FKs, or NOT NULL columns that were missed
- Dead imports, unused state, forgotten cleanup, orphan files
- Inconsistent naming between layers (DB slug vs TS enum vs UI label)
- Anything a staff engineer would ask about in code review

Fix anything you find before moving on. Don't rationalize — if it's a real bug, it ships as a fix in the same session.

**2. Backend end-to-end tests.** Exercise every new RPC, trigger, constraint, and schema invariant against the live Supabase DB via the Management API (honoring the migration workflow in the Git & Deployment section). For each item test:
- A happy path (valid input, expected outcome)
- At least one failure path (constraint violation, authorization rejection, NULL handling, self-referential edge)
- Invariants stay intact after the test (partial unique indexes, FKs, row counts)

Any test data created here must be deleted before step 4.

**3. Frontend end-to-end tests.** Spin up the dev server via the Claude Preview MCP. Log in as the user (credentials are saved in my memory — if missing, ask the user). Walk every user-facing path the feature added or modified. Verify:
- The new UI is reachable from the nav and renders correctly
- Every interactive element (buttons, toggles, dialogs, dropdowns) commits the expected state to the DB
- The feature works in both empty-state and populated-state on a real team with production data
- Existing features that might regress still work (status filters, dashboard metrics, mark-as-sent, etc.)
- URL-persisted state survives reload + back/forward
- The notification pipeline, if touched, actually delivers (check the notifications table for inserted rows)

**4. Cleanup + report.** Delete any synthetic test rows, notifications, uploads, or quotes you created in steps 2-3. Restore any production data you temporarily modified. Then report:
- What you audited and what you fixed during the audit
- Which backend tests passed, with evidence (row counts, SQL result snippets)
- Which frontend paths you verified, with screenshots where meaningful
- Anything you couldn't fully test and why (e.g., "Phase 3 needed a real file upload which would pollute prod, logic is covered by type checks + unit tests")
- Any regressions or follow-ups discovered that aren't in scope for this session

Verification is not a checkbox — it's the user's protection against bad production deploys. Treat it as first-class work, not an epilogue.

### 12. Scraper Engineering Log — Auto-Logging Discipline (MANDATORY, NO REMINDERS)

There is a running log at `tasks/scraper-log.md` that is the project's PERSISTENT MEMORY for scraper / anti-bot / transport work. You MUST read it before any scraper task and MUST update it continuously during scraper work. **The user should never have to tell you to "take notes" or "log this" — that's the default behavior for every scraper-related session.**

#### When this rule activates (every time, without prompting)

ANY task involving: scraping, anti-bot bypass, proxies, captcha solvers, browser automation (Patchright, Camoufox, Playwright), Bright Data, ScraperAPI, IPRoyal, CapSolver, 2Captcha, Hyper Solutions, Apify, plugins under `python-workers/<program>/`, `common/browser.py`, `common/scrape_client.py`, the `/diag/*` worker endpoints, Akamai, Imperva, DataDome, Cloudflare, Kasada — or anything else airline-/scrape-/bot-defense-adjacent.

#### Step 1 — Read first (before any technical proposal)

1. Open `tasks/scraper-log.md`.
2. Read the "Quick reference: working state" table — know which plugins return real data vs which silently return `[]`.
3. Read the "Tools / services tried" table — if a tool appears in the "failed" column, do NOT propose it again unless you can explain what's materially different this time (vendor added a new product, failure mode was a fixable bug rather than a fundamental limitation, a specific config wasn't tried, etc.).
4. Read the most recent "Session log" entry — know what the previous session left in flight.
5. Read the "Open angles, fully expanded" section — these are the prioritized next moves with hypothesis + steps + cost + risk for each.

If you skip this and re-propose ScraperAPI, CapSolver-for-Akamai, or Patchright-against-AA, you have wasted the user's time and the log explicitly tells you why.

#### Step 2 — Log as you go (not as a wrap-up)

The wrong pattern: do 3 hours of work, then ask "should I update the log?" The right pattern: log incrementally as each meaningful event happens. Write a note BEFORE moving on to the next attempt.

Every one of these triggers an immediate log update — without waiting for permission:
- **Found a new endpoint, URL, or API shape** → log it with the exact URL/method/body/response shape
- **A tool/service returned an unexpected response** → log the full error message (verbatim) + the HTTP status + body length + what request you sent
- **A response status changed** (status code, response shape, error code) → log before/after
- **A configuration parameter mattered** → log the exact param name + value that made the difference (`use_brightdata=True`, `wait_until="domcontentloaded"`, `headless="virtual"`, etc.)
- **A migration moved a plugin's status** in the "Quick reference: working state" table → update the table inline
- **A subagent returned research** → distill its findings into the log (don't just leave it in the agent output stream — that's ephemeral)
- **An obscure flag/quirk was discovered** (BD's WU uses `body` not `data`, sensor.js path is randomized, AA's CSRF token format is `<uuid>`, etc.) → log it
- **You wrote a one-off testing command that worked** → paste it into the "Useful testing commands" section
- **A commit landed** → add it to the commit log table at the bottom of the chronicle
- **An infrastructure quirk hit you** (Fly auto-stop, sandbox blocks port 9222, GitHub Actions cache miss, etc.) → log it in the "Deploy / infra learnings" section

#### Step 3 — Log entries must be EXTREMELY detailed

Not "tried Camoufox, didn't work." THAT IS USELESS. The kind of detail required:

- **Exact verbatim error messages** (copy-paste, don't paraphrase): `'CapSolver createTask failed: {"errorCode": "ERROR_TYPE_NOT_SUPPORTED", "errorDescription": "unsupported captcha type, please check if the type is correct: AntiAkamaiBMTask", "errorId": 1}'`
- **Sample request bodies + sample response bodies** with byte counts: "AA returned `{\"error\":\"309\",...}` (96 bytes) for any cookie/header combination; verified 6 variations, all identical."
- **Exact config that mattered**: not "tweaked Camoufox" but `AsyncCamoufox(headless="virtual", humanize=True, block_webrtc=True, geoip=False, window=(1366, 768))`.
- **Quantitative observations**: "page-load success rate ~33% morning of 2026-05-19 via BD Browser API with Referer trick, dropped to ~0% by evening as Akamai re-flagged BD's pool."
- **The exact curl/Python command to reproduce** the test, copy-pasteable into the next session's terminal.
- **What you tested vs what you DIDN'T test** (so the next session knows the negative space).
- **Specific commit SHAs** that introduced or fixed something.

A good log entry looks like a forensic post-mortem. A bad log entry looks like a tweet. Default to forensic.

#### Step 4 — Specific sections to keep current

- **"Quick reference: working state" table** — single source of truth for which plugins return real data. Update inline when a plugin's status flips (don't leave a plugin marked 🚧 if it's now ✅ working or vice versa).
- **"Tools / services tried" table** — every tool/service evaluated, with verdict + date + reason. Move entries between rows when verdicts change.
- **"Session log" (bottom)** — date-stamped chronological findings. Append a new section every meaningful session. Don't edit prior entries (they're a record of what was true at that time).
- **Sample responses section** — verbatim HTML / JSON for each distinct response shape observed. New shape = new sample.
- **"Useful testing commands" section** — every reusable curl/Python snippet. Future-you will paste these.
- **"Open angles, fully expanded" section** — prioritized list of untested paths with hypothesis + steps + cost + risk. Promote to "tried" when tested; demote to "abandoned" with explanation when ruled out.
- **"If you need to..." cookbook** — common debug scenarios with exact steps. Add a new entry whenever you figure out how to do something non-obvious.

#### Step 5 — Verify your notes are detailed enough

After any logging update, check: would a fresh Claude with NO conversation context, reading only `tasks/scraper-log.md`, be able to:
- Identify which plugins are real vs broken? (yes if Quick reference table is current)
- Avoid re-trying CapSolver for Akamai? (yes if Tools table mentions it's deprecated, with date)
- Reproduce your last test? (yes if curl command + expected response are in the log)
- Know what the next 3 untested angles are? (yes if Open angles section is current)
- Understand the user's constraints (60-day cap, every-flight-every-carrier)? (yes if User constraints section is captured)

If any of those is "no," your log isn't detailed enough yet. Fix it before moving on.

#### Why this matters

Earlier sessions spent literal hours rediscovering: ScraperAPI is broken, IPRoyal blocks aa.com at CONNECT, CapSolver dropped Akamai, Patchright fails sensor.js validation, BD WU's POST field is `body` not `data`, mobile.aa.com redirects to www.aa.com/homePage.do, AA serves three distinct Akamai response shapes by html_len, Camoufox+Fly gets behavioral challenge that doesn't clear in 40s. Every one of those is a learnable fact that should have been written down the first time. **The log is the memory the project doesn't otherwise have. Treat it as such.**


## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Push Back When Wrong**: If a user's idea won't actually improve things, say so directly. Explain the technical reasoning, propose what would actually help, and don't build something just because it was asked for. The user expects honest engineering judgment, not compliance.
- **Explain Simply**: When discussing technical fixes or engine math, use concrete dollar examples (e.g., "$20 list price × 21% fuel rate = $4.20"), NOT source code references (no `calcFuelCost`, `frtPublished`, `ourTransportCost`). The user finds plain-English walkthroughs much easier to follow.
- **Test Before Asking User**: After any code edit, run backend end-to-end tests on the edited logic BEFORE asking the user to re-test in the UI. If tests catch a problem, fix it first. This prevents wasting the user's time on broken changes.
- **Self Audit Your Own Plans**: Before implementing any plan, audit it for correctness and completeness. Ask yourself: "Would a staff engineer approve this?" If not, revise the plan before presenting it.
- **Pick the Right Layer Before Coding**: Before finalizing any non-trivial plan, steelman at least one lower-layer alternative. If the plan touches 3+ files with similar conditional logic, or you're patching the same symptom in multiple save/load paths, consider whether the invariant belongs in the DB (trigger, constraint, generated column) or a single RPC instead. Name the real data-model signal behind the behavior — if it has a clean DB expression, the fix probably belongs there. Caveats like "narrow race condition" or "remember to add this to every future path" in your first draft are redraft signals, not acceptable footnotes.