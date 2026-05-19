# PointSnap Scraper Recovery — Execution Blockers

Append-only escalation log. **If this file is empty, nothing needs human input.**

When an agent hits a blocker it can't resolve via the rules in the plan's "Failure handling decision tree," it appends here. The user reads this file when checking back; agents read this file before retrying a previously-blocked task.

Format:
```
## YYYY-MM-DD HH:MM — <plugin or task>
**Blocker**: <one sentence>
**Attempted**: <list of tiers + verbatim errors>
**Suggested next**: <2-3 concrete experiments user can authorize>
**Cost so far**: <BD spend $X, commercial spend $Y>
```

---

<!-- No active blockers as of 2026-05-19 16:45. Phase 0 in flight. -->
