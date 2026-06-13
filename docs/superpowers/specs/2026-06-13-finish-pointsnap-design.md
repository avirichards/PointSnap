# Finish PointSnap — Goal + Execution Loop (Session 20, 2026-06-13)

## Context

PointSnap is live in production (cockpit + 3 real scrapers). The frontier is the
scraper grind: 3/13 programs return real rows (VS, AS, B6); AC is one fresh
user login away; AA/DL are anti-bot research problems; 7 programs are
login-walled by airline design and route through the Phase 2.5 auth-capture
flow, which is built but not end-to-end verified.

The user instructed: take inventory, set a goal + loop, run autonomously until
done. The one allowed question round was declined, so the run proceeds on
recommended defaults (recorded in the session transcript and below).

## Definition of done

Every program in the 13-program launch set reaches exactly one terminal state:

| State | Meaning | Evidence required |
|---|---|---|
| **LIVE** | `/search?program=X` returns real award rows from the deployed worker | curl output with ≥1 row, logged in scraper-log |
| **USER-GATED** | Code path verified up to the point where only a user action remains (login, Mac online, dashboard toggle) | diag evidence the flow works to the gate + exact user action documented in the final checklist |
| **BLOCKED-WITH-FORENSICS** | Every currently-documented free angle tried this run | forensic blockers.md entry: verbatim errors, what was/wasn't tested, costed next experiments |

Plus, product completion:
- Clerk wired into `/airlines` (auth-capture page can identify users)
- VS `flight_number` parser drift fixed
- Wallet + sweet-spots pages completed to Phase-1 scope (HIG-audited)
- Tests green (`pnpm test`, `pnpm typecheck`, `pnpm build`, `pytest`)
- scraper-log / progress.md / blockers.md current; KB drafts written
- CLAUDE.md rule-11 verification pass executed
- Branch pushed, draft PR open, consolidated user-action checklist delivered

## Operating defaults (adopted after declined question round)

1. **Deploys**: `claude/gifted-faraday-ldfwgx` added to `deploy-workers.yml`
   trigger branches (precedent: two prior session branches are already listed).
   Worker deploys to the production Fly app; VS/AS/B6 must stay green —
   verified after every deploy.
2. **Spend**: ≤ $10 Bright Data bandwidth this run; free transports first.
3. **User gates**: batched. Tailscale-dependent paths are USER-GATED now
   (exit node `avis-mac-mini` offline, last seen 1d before session start).
4. **No merge to main** — that stays on explicit user trigger per CLAUDE.md.

## The loop

```
while queue has non-terminal items:
    pick highest (impact × confidence / cost) item
    implement → commit → push (deploy if python-workers/** touched)
    live-verify against the deployed worker (/diag/*, /search)
    log forensically in scraper-log.md / progress.md (incremental, not batched)
    re-rank queue; demote any angle after 3 iterations without a progress signal
verification pass (rule 11) → KB drafts → push → draft PR → user checklist
```

Guards: BD spend ledger kept in progress.md; an angle that stalls 3 consecutive
iterations gets a blockers.md entry and is demoted rather than ground forever.

## Initial queue (ranked)

1. **Deploy-path validation** — add branch to deploy-workers.yml, push, confirm
   GH Action deploys, worker healthy, VS/AS/B6 still return rows.
2. **Full 13-plugin probe sweep** — refresh the working-state truth table
   (last full sweep 2026-05-19; three weeks stale).
3. **UA deploy-verify** — WU 3-step transport was built but never verified;
   possible instant 4th LIVE program.
4. **VS `flight_number` parser fix** — known drift ("CAL" vs "3").
5. **AA + DL: BD Browser API in-page XHR capture** — the Session-14
   "breakthrough lead": mint + search inside ONE BD Browser API context so the
   session is never transported. Does not need Tailscale. Template for both.
6. **AV LifeMiles probe** — never classified by the WU grind (the one airline
   the 9-airline sweep missed); LifeMiles historically has anonymous endpoints.
7. **Calendar/GET-endpoint recon** for remaining blocked siblings (per the
   Session-13 recon playbook: JS bundle → grep endpoints → WU probe).
8. **Auth-capture to USER-GATED** — wire Clerk into `/airlines`, verify the
   capture flow end-to-end up to the airline login screen (screenshot-stream
   live-view), confirm every auth-walled plugin cleanly reports
   `auth_required` and consumes a captured session when present.
9. **Wallet + sweet-spots completion** (apple-hig audit first).
10. **Rule-11 verification pass + KB drafts + handoff checklist + draft PR.**

## Known user-action checklist (accumulates during the run)

- Bring `avis-mac-mini` online as Tailscale exit node (gates AC end-to-end,
  AA Variant-A)
- Fresh AC Aeroplan login via cockpit `/airlines` immediately before an AC test
- One-time logins for the 7 auth-walled programs once capture flow is verified
- (If pursued) BD dashboard: enable "Manual Expect" on the WU zone — likely
  moot given the WU dead-end for AA
- Decide merge-to-main after reviewing the draft PR
