# The date picker now knows each airline's real booking window

**Status:** Draft for KB. Not yet published.
**Surface:** `/search` (the cockpit search form)
**Shipped:** 2026-05-20

## What's new

The **Depart** date field on the search form is now bounded to how far
ahead airlines actually open award seats. You can no longer pick a date
the airlines simply won't have inventory for.

- The calendar greys out dates beyond the furthest-out program's window.
- A small hint under the field tells you the limit, e.g.
  *"Airlines open awards up to ~360 days out."*
- If you land on the search page with an old link or use the browser's
  back button to a date that's now too far out, an amber notice explains
  *"Past every airline's booking window — most programs won't return
  results this far out."*

## Why this matters

Award travelers plan 6-11 months ahead. A competing tool caps every
search at **60 days out** — that turns an award-planning tool into a
last-minute-deals tool. PointSnap deliberately does **not** do that.

Each airline opens its award calendar a fixed number of days before
departure, and the windows differ:

- American, Delta, Alaska, Virgin Atlantic, JetBlue: ~331 days
- United: ~337 days
- Air Canada, ANA, Turkish, Singapore: ~355 days
- Lufthansa, Cathay, Avianca, Emirates, SAS, Finnair, Flying Blue: ~360 days

Because one search checks every program at once, the calendar lets you
pick any date that's valid for **at least one** airline — so you're
never blocked from a date some program can still book.

## How it works (for the curious)

The booking windows live in one place the engine reads
(`program_windows.py` for the technical reader), cross-checked against
published award-release-date tables. The search form fetches them and
sets the calendar's upper bound automatically. If that lookup ever
fails, the calendar simply stays fully open rather than blocking you.

## Limitations

- The windows are **approximate**. Airlines re-tune them, and a few
  toggle their calendars a few days further than the default. The
  picker errs toward *allowing* a date rather than wrongly blocking one.
- A date being *inside* an airline's window doesn't guarantee that
  airline returns results — it just means the date is worth searching.
  Some carriers also hide far-out award space from non-logged-in
  searches; connecting your account (where supported) helps there.

## What to update in the FAQ

If the FAQ mentions how far ahead you can search, replace any fixed
number with "up to each airline's real booking window — roughly 11
months for most programs."
