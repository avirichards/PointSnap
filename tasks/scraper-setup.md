# Real Scraper Setup — Things to Sign Up for Before Session 5

Three paid services + one free hosting account. Total cost to start: ~$25-50/month at the volume PointSnap needs for an MVP launch. All offer free trials or pay-as-you-go.

These are needed for the **real** Virgin Atlantic scraper (replaces the hard-coded JFK→LHR row currently inlined in `/api/search`). Same accounts cover the other 12 launch programs through Session 10+.

---

## 1. IPRoyal — Residential Proxies (required)

**Why:** Every real scraper hits the airline's site from a residential IP, not a datacenter IP. Airlines aggressively block AWS/GCP/Azure IPs. Residential proxies route traffic through real consumer ISPs so we look like a normal user. Without this, every Patchright request gets 403'd at the edge.

**Cost:** Pay-as-you-go, ~$1.75 / GB for "Royal Residential" up to ~$7 / GB for "Premium Royal Residential" (geo-targeted to specific countries). MVP-scale traffic is ~5-10 GB/month → **$10-70/month**.

**Steps:**
1. Open **https://iproyal.com** → click **Sign Up** (top right)
2. Pick **Residential Proxies** plan type. The cheapest tier ("Royal Residential", $1.75/GB, $1 minimum) is fine for getting started.
3. Verify your email.
4. In the dashboard sidebar, click **Residential** → **Order**. Buy the minimum ($1) — it's a credit balance, not a subscription. Plenty to validate VS scraping end-to-end.
5. Once paid, go to **Residential** → **Plans & Orders** → click your order → **Manage**.
6. You'll see your proxy credentials. Note these three things — paste them back to me:
   - **Username** (looks like `username_country-us`)
   - **Password** (random string)
   - **Endpoint** (something like `geo.iproyal.com:12321`)

Optional: also generate an **API token** if you want to programmatically rotate residential exits. Profile → API → Generate Token. Not strictly required for Session 5; nice to have.

**What I'll do with these:** add them as GitHub repo secrets (`IPROYAL_PROXY_USER`, `IPROYAL_PROXY_PASS`, `IPROYAL_PROXY_HOST`) so the Fly.io worker can authenticate to the proxy network. Also added to your local `.env.local` if you ever want to run scrapers from your machine.

---

## 2. CapSolver — CAPTCHA Solver (required)

**Why:** Most airline sites are protected by Akamai Bot Manager, Imperva, DataDome, or hCaptcha. When the scraper triggers a challenge, we POST it to CapSolver, they return a token, we continue. Without this, the scraper stops at the first challenge.

**Cost:** Pay-as-you-go, **~$0.0015–$0.003 per solve**. For MVP-scale (~5,000 queries/day × ~1 challenge per 20 queries = 250 solves/day) → **$10-20/month**.

**Steps:**
1. Open **https://capsolver.com** → click **Sign Up** (top right). Or use the **Continue with Google** button.
2. Verify email.
3. Once in the dashboard, click **Balance** → **Add Funds**. **$5 is plenty** to validate the VS pipeline. You won't burn through it in a session.
4. Click **API Keys** in the sidebar (or **Settings → API Keys** depending on the UI version).
5. Generate a new key (give it the label "pointsnap"). Copy the key and paste it back to me. Looks like `CAP-...` followed by a long string.

Optional backup: **2Captcha** (https://2captcha.com) is the same kind of service from a different vendor. Sign up later as a fallback if CapSolver's success rate dips on a specific program. Same token-paste pattern.

---

## 3. Fly.io — Python Worker Hosting (required)

**Why:** The scraper is a Python service running Patchright (a stealth Chromium). It can't run on Vercel (Vercel functions are 10-second cap; Patchright bootstraps can take 30+ seconds). So we host the scraper on Fly.io as a long-running container; the Next.js `/api/search` route HTTP-calls it when it needs a real scrape.

The repo already has `python-workers/Dockerfile` + `python-workers/fly.toml` from session 4, plus a GitHub Actions workflow at `.github/workflows/deploy-workers.yml` that auto-deploys on push. We just need the Fly.io auth token.

**Cost:** Fly's free tier covers ~3 small VMs (256 MB / shared CPU). For one Python worker, you can stay on free tier indefinitely while the project is pre-launch. Once we have real users, the worker will need ~$5-10/month.

**Steps:**
1. Open **https://fly.io** → **Sign Up** (top right). Use GitHub login — fastest.
2. Add a payment method (free tier still requires one on file; you won't be charged unless you exceed limits).
3. In the dashboard, top-right click your avatar → **Access Tokens** → **Create Access Token**.
4. Label it "pointsnap-github-actions". Token type: **Default** (full account access — fine since this is your only Fly app for now).
5. Copy the token (looks like `FlyV1 fm2_lJP...`). Paste back to me.

**Note:** The previous session set up the GitHub Actions deploy workflow and tried to deploy, but the sandbox couldn't reach Fly's builder over TLS. Now that we'll use GitHub Actions (which has clean network egress), this just works on the first push to `python-workers/`.

---

## 4. GitHub Secrets (where I'll put the tokens)

After you paste me the credentials, I'll add them to the repo as secrets so the Actions workflow can use them. You don't need to do this part — just hand me the tokens.

The secret names are:
- `IPROYAL_PROXY_USER`
- `IPROYAL_PROXY_PASS`
- `IPROYAL_PROXY_HOST`
- `CAPSOLVER_API_KEY`
- `FLY_API_TOKEN`

If you want to add them yourself: **github.com/avirichards/PointSnap → Settings → Secrets and variables → Actions → New repository secret** for each.

---

## What to do in what order

The cheapest, fastest path to a working real VS scraper:

1. **Sign up for Fly.io first** — free, fastest. Get the access token. (5 min)
2. **Sign up for CapSolver** — fund with $5. Get the API key. (5 min)
3. **Sign up for IPRoyal** — buy $1 of Royal Residential. Get the three proxy creds. (10 min — they verify your account, which can be instant or take an hour)
4. **Paste everything back to me in one message** when you have all six values. Don't paste them in chat one at a time — single message is safer (less chance of one getting cached, lost, or accidentally screenshotted).

**Total time:** ~20 minutes of clicks. **Total cost:** ~$6 to start, ~$25-50/month at MVP scale.

---

## When NOT to do this yet

If you'd rather hold for a week or two until the cockpit is more polished, that's fine. We can keep extending the inline / mock data path for cosmetic improvements (more programs hard-coded, chart fallback wired up, etc.) without spending a cent on real scraping. The cockpit demo works fine in that mode and is a credible portfolio piece even without live scraping.

Worth signing up earlier if you want to:
- Have everything ready so Session 5 is "just code" not "code + signups"
- Get a real VS row in the cockpit by next week
- Avoid the friction of pausing mid-build to sign up

Worth deferring if you want to:
- See more polish first
- Hold the ~$25 monthly burn until later
- Watch how the cockpit feels with chart fallback alone (we'll wire that up later this session)

Either is fine. Let me know which.
