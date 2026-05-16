## Git & Deployment Workflow (CRITICAL — READ FIRST)

**This app is in production with live users. Protect the live site at all costs.**

### Branch structure

- **`main`** — production. Vercel deploys from here. **Never push directly to `main`** (except on explicit "this is urgent" trigger).
- **`dev`** — active staging / integration. Vercel previews from here. This is the target for merges — each conversation's work flows *through* `dev`, not directly *on* it.
- **`claude/<slug>`** / **`feat/<topic>`** / **`fix/<topic>`** — short-lived per-conversation branches. Created inside an isolated worktree at the start of each conversation; merged into `dev` when the work is ready; deleted when the conversation ends. Kebab-case, short but specific.

**Never commit directly to `dev`, `main`, or someone else's feature branch.**

Flow:
1. Conversation starts → `EnterWorktree` creates a feature branch off `dev`. See §One worktree per conversation.
2. Commit frequently as you work (after each logical milestone). Uncommitted work is fragile across tool restarts and refused by `ExitWorktree`.
3. When the user says **"push it"** → push the feature branch (Vercel previews every pushed branch). Merge into `dev` only when the user explicitly asks to land the work.
4. When the user says **"go live" / "push it live" / "merge to main"** → merge `dev` into `main`, push `main`, Vercel deploys production.
5. When the conversation is done → `ExitWorktree` with `action: "remove"` once the branch is merged (if paused mid-flight, use `action: "keep"` so it can be resumed).

After any merge to main:
- Sync `dev` with `main` (`git merge main` on `dev`) so the preview branch doesn't drift behind production.

### One worktree per conversation

Claude Code runs multiple conversations against the same repository. A single working directory can only have one branch checked out — if two conversations share that directory and one runs `git checkout`, the other loses its files mid-work. This caused a "rates disappeared" incident once; don't repeat it.

Use git worktrees to isolate each conversation. The branch-per-conversation rule becomes **worktree-per-conversation** — a stronger guarantee since worktrees hard-prevent concurrent branch conflicts, not just by convention.

**At the start of any conversation that will touch code:**
1. **Audit stale branches first.** Run `git branch --no-merged dev` to see which feature branches still carry unmerged work. For each one, check uncommitted state (`git -C <worktree> status`), commits ahead of dev, and how old it is. Surface the list to the user before starting new work: *"Heads up, N branches behind dev from prior conversations: X (N commits), Y (N commits). Want to land any before we start, or leave them for now?"* Do not silently start fresh work on top of a graveyard — the longer stale branches sit, the harder the eventual consolidation. One day of drift is cheap; two weeks compounds.
2. Call `EnterWorktree` to create a private working directory + branch. Branch should be named `claude/<short-feature-slug>` (or `feat/<topic>` / `fix/<topic>` for a human-named workstream). Use kebab-case, short but specific.
3. That worktree is yours for the whole conversation — files, dev server, preview, everything stays isolated there.
4. Never `git checkout <other-branch>` inside another conversation's worktree, and never `git checkout` branches that are already checked out elsewhere (git refuses anyway — a branch can only be checked out by one worktree at a time).

**Before ending the conversation:**
1. Commit every change. `ExitWorktree` refuses to remove a worktree with uncommitted changes — that's the safety rail.
2. **Explicitly ask the user to pick a landing outcome** before calling `ExitWorktree`. Don't default to "keep" silently — that's how branches silently accumulate. Three options:
   - *Merge to `dev` now* → feature is complete, user wants preview on the main dev URL → merge, then `ExitWorktree` with `action: "remove"`.
   - *Keep branch for continuation* → work is paused mid-flight and the next session will resume it → `ExitWorktree` with `action: "keep"`. Briefly note what's left.
   - *Discard* → the work turned out to be a dead end → confirm explicitly, then `ExitWorktree` with `action: "remove"` and delete the branch.
   If the user doesn't answer, default to "keep" but leave a clear note in the conversation transcript so the next start-of-conversation audit surfaces it.

**Exceptions** (don't create a new worktree):
- Read-only conversations (answering questions, searching code). Fine to work in the main repo dir.
- Continuing an explicitly-in-progress conversation whose worktree already exists — reuse it.
- Database-only work that doesn't modify source files.
- Trivial single-file fixes the user explicitly requests against a named branch.

When in doubt, ask the user what branch / worktree to use before editing.

**When to merge back to `dev` vs. hold on the feature branch:**
- Merge to `dev` when: the feature is complete AND the user wants to preview it, OR the user says "push it".
- Hold on feature branch when: work is iterative and the user is still reviewing inside the current conversation — multiple commits will accumulate before merge. The Vercel preview URL still updates on pushes to the feature branch (Vercel previews every pushed branch), so you can share it without merging.

### When the user says "push it to GitHub" or "push it":
1. Push the **current feature branch** first (Vercel previews every pushed branch, so the user can review the exact WIP).
2. If the user specifically asks to land the work, merge into `dev` and push `dev`.
3. Never push to `main` directly.

### When the user says "push it live", "go live", or "merge to main":
1. Ensure the feature branch is merged into `dev` (if not already).
2. Merge `dev` → `main` and push `main`.
3. Vercel automatically deploys to the live production site.
4. After the merge, switch back to the feature branch (or `dev`) for any follow-up work.

### When the user says "this is urgent, push straight to production":
1. This is the ONLY time you push directly to `main`.
2. Confirm with the user before doing it.

### Database migrations — Claude applies, not CI

**User-facing rule:** the user says what they want changed; Claude does everything.

There is no CI migration workflow. Claude owns the full apply loop because the user is non-technical and a mismatch between the `supabase/migrations/` folder and the `supabase_migrations.schema_migrations` tracking table previously caused every CI run to go red. Claude prevents drift by applying + recording in the same session.

**When a schema change is needed, Claude must do all of the following — in order — for every migration:**

1. **Write the file** at `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql`. Use a full **14-digit UTC timestamp** prefix (e.g. `20260418213055_add_foo_column.sql`), not an 8-digit date. This matches Supabase CLI convention and future-proofs the repo if CI is ever reinstated.
2. **Write the SQL idempotently.** `CREATE OR REPLACE` for functions, `CREATE ... IF NOT EXISTS` for tables/indexes/types/policies, `DROP ... IF EXISTS` for removals. End each migration with `NOTIFY pgrst, 'reload schema';` if it changes anything PostgREST exposes.
3. **Apply it to the live DB** via the Supabase Management API using the access token in `~/.claude/settings.json`:
   ```
   POST https://api.supabase.com/v1/projects/<project-ref>/database/query
   { "query": "<full SQL>" }
   ```
   The project ref is in settings.json.
4. **Record it in the tracking table** in a separate call, in the same session, before moving on:
   ```sql
   INSERT INTO supabase_migrations.schema_migrations (version)
   VALUES ('YYYYMMDDHHMMSS')
   ON CONFLICT (version) DO NOTHING;
   ```
   The version string must match the filename prefix exactly. This step is what keeps the tracking table in sync with the filesystem — skipping it is the cause of every past drift.
5. **Verify** by re-reading the object(s) the migration touched (e.g., `pg_get_functiondef` for a function, `\d table` equivalent for a table) and, where meaningful, calling the RPC end-to-end with the anon key.
6. **Commit** the `.sql` file to the current branch with a descriptive `fix(db):` / `feat(db):` message. Do **not** bundle schema commits with unrelated code changes.
7. **Push** to `dev` per the normal branch rules above. Only merge to `main` on explicit user trigger phrases.

### Database branches — default for any non-trivial DB work

We have Supabase branching enabled (Pro tier). The rule is the same idea as the `dev` git branch for frontend work: **any time you are about to make a database change that isn't a one-line read-only tweak, do it on a branch first, not against production.**

**When to branch:**
- Any new table, new column, or index on an existing table.
- Any change to an RPC, trigger, or RLS policy.
- Any migration that moves, copies, deletes, or renames existing data.
- Any multi-step DB work where one step depends on another.

**When direct-to-prod is OK:**
- Single-statement, trivially reversible changes the user specifically asked for as one-offs (e.g. bumping one config row, seeding a single lookup value).
- `NOTIFY pgrst, 'reload schema';` and similar no-data-touching ops.
- Read-only queries for investigation.

**Branch workflow:**

1. Create the branch via the Supabase Management API:
   ```
   POST https://api.supabase.com/v1/projects/<project-ref>/branches
   { "branch_name": "<short-kebab-descriptor>" }
   ```
   The response returns a new `project_ref` specific to the branch. Record it — every subsequent SQL call for this work must use the branch's project_ref, not production's.
2. Apply the migration(s) via `…/v1/projects/<branch-project-ref>/database/query`. Run verification queries against the branch. Seed any test data you need (branches clone schema + migrations, not production data).
3. If the frontend needs to hit the branch, have the user set Vercel Preview env vars (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) to the branch's URL/anon key, scoped to the `dev` git branch. Provide the exact values — the user won't know them.
4. When the user approves the changes, merge the branch:
   ```
   POST https://api.supabase.com/v1/branches/<branch-id>/merge
   ```
   Only migrations + edge functions merge; hand-seeded test data stays on the branch.
5. Re-run the backend verification against production to confirm the merge landed cleanly.
6. Delete the branch via `DELETE …/v1/branches/<branch-id>` so it stops being billed.

**Rollback safety layers to write alongside every branch-flow migration:**
- The migration SQL itself, idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`).
- A matching rollback SQL at `supabase/rollbacks/<same-prefix>_rollback.sql` that drops what the migration added and un-records the version from `supabase_migrations.schema_migrations`.
- For destructive migrations, write backup tables (`CREATE TABLE dashlink_backup_YYYYMMDD__foo AS SELECT …`) inside the same transaction, BEFORE the delete, so the rollback can re-insert.
- For anything touching existing production rows, capture a JSON snapshot to `scripts/<feature>-pre-migration-snapshot.json` and commit it to the repo before starting.

**Other constraints:**
- **Prefer additive changes** (new columns, new tables) over destructive ones. Split "add new thing" and "remove old thing" into two separate migrations applied in two separate sessions — the gap between them is the verification window.
- If a migration must drop or rename existing user-visible data, pause and explicitly confirm with the user before applying, even in auto mode.
- Never apply raw SQL that isn't also saved as a migration file — that is exactly how the tracking table drifted out of sync in the past.
- Temp files containing the access token (e.g. `/tmp/*.json` used for `--data-binary`) must be deleted at the end of the task.

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


## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Push Back When Wrong**: If a user's idea won't actually improve things, say so directly. Explain the technical reasoning, propose what would actually help, and don't build something just because it was asked for. The user expects honest engineering judgment, not compliance.
- **Explain Simply**: When discussing technical fixes or engine math, use concrete dollar examples (e.g., "$20 list price × 21% fuel rate = $4.20"), NOT source code references (no `calcFuelCost`, `frtPublished`, `ourTransportCost`). The user finds plain-English walkthroughs much easier to follow.
- **Test Before Asking User**: After any code edit, run backend end-to-end tests on the edited logic BEFORE asking the user to re-test in the UI. If tests catch a problem, fix it first. This prevents wasting the user's time on broken changes.
- **Self Audit Your Own Plans**: Before implementing any plan, audit it for correctness and completeness. Ask yourself: "Would a staff engineer approve this?" If not, revise the plan before presenting it.
- **Pick the Right Layer Before Coding**: Before finalizing any non-trivial plan, steelman at least one lower-layer alternative. If the plan touches 3+ files with similar conditional logic, or you're patching the same symptom in multiple save/load paths, consider whether the invariant belongs in the DB (trigger, constraint, generated column) or a single RPC instead. Name the real data-model signal behind the behavior — if it has a clean DB expression, the fix probably belongs there. Caveats like "narrow race condition" or "remember to add this to every future path" in your first draft are redraft signals, not acceptable footnotes.