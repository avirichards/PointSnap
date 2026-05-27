# My Airlines — connect a loyalty account to search login-only programs

Most airline loyalty programs no longer show award space unless you're logged
in. **My Airlines** (in the top nav) lets you connect each of your loyalty
accounts once, so PointSnap can search award space on those programs for you.

## How connecting works

1. Open **My Airlines** from the nav. You'll see every program PointSnap
   supports, each with a status badge — *Connected*, *Expiring*, *Session
   expired*, *Not connected*, or *No login needed*.
2. Click **Connect** on a program (for example, Air Canada Aeroplan).
3. A window opens with a **live, secure browser** showing that airline's own
   login page. Click into the page and sign in exactly as you normally would —
   including any two-factor / one-time code the airline sends you.
4. Once PointSnap detects that you're signed in, it captures your session and
   the window closes. The program's badge turns to *Connected*.

After that, whenever you run a search that includes that program, PointSnap
uses your connected session automatically — you don't log in again each time.

## What PointSnap stores (and what it doesn't)

- PointSnap **never sees or stores your password or your 2FA codes.** You type
  those into the airline's own login page inside the secure browser window.
- What PointSnap saves is the **session** the airline hands back after a
  successful login — the same thing that keeps you logged in in a normal
  browser. It's **encrypted** before it's stored, and only decrypted for the
  moment a search runs.
- You can **disconnect** a program at any time, which deletes the saved
  session.

## Things to know

- **Sessions expire.** Airlines expire logins after a while (often about a
  day). When a program's badge says *Expiring* or *Session expired*, just click
  **Reconnect** and sign in again.
- **"No login needed" programs.** A few programs (e.g. Alaska Mileage Plan)
  show award space without a login — those have no Connect button and just
  work.
- **The login window is a real browser.** It runs on PointSnap's side, not on
  your computer, so your own browser's saved passwords won't autofill — type
  your credentials in, or paste them.
- **One airline at a time.** Connect programs one by one; each takes under a
  minute once the login window loads.
