FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/app/.cache/camoufox

# Native deps for both Patchright (Chromium) AND Camoufox (Firefox).
# Camoufox uses headless="virtual" which spawns Xvfb internally — so AA's
# Akamai BMP detects a "headful" Firefox session even though we're in a
# headless container.
# `coreutils` is pulled in for a guaranteed `timeout` binary (the entrypoint
# bounds `tailscale up` with it). `iptables`/`iproute2` are NOT needed:
# Tailscale runs in userspace-networking mode (no TUN device, no NET_ADMIN).
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates xvfb coreutils \
    fonts-liberation fonts-noto-color-emoji \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdbus-glib-1-2 libdrm2 libgbm1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libpci3 libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 libxt6 libxtst6 \
    xdg-utils libu2f-udev libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

# Tailscale — copied straight from the official image (no apt repo needed).
# Used ONLY to route the Air Canada Aeroplan award-search Camoufox transport
# through a residential exit node (the user's home Mac), defeating AC's
# Kasada data-center-IP 429. tailscaled runs in userspace-networking mode
# (see entrypoint.sh) — no TUN device, no NET_ADMIN, cannot break the
# container. Pinned to a specific version for reproducible builds.
COPY --from=docker.io/tailscale/tailscale:v1.96.5 /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY --from=docker.io/tailscale/tailscale:v1.96.5 /usr/local/bin/tailscale /usr/local/bin/tailscale

WORKDIR /app

COPY pyproject.toml ./
RUN pip install \
    fastapi 'uvicorn[standard]' httpx 'psycopg[binary]' \
    python-dotenv json5 \
    patchright \
    'camoufox[geoip]>=0.4' \
    selectolax \
    'curl-cffi>=0.7'

# Install Chromium for Patchright (legacy path for non-AA plugins).
RUN patchright install chromium

# Fetch Camoufox's stealth Firefox bundle + GeoIP DB at build time so the
# first request doesn't pay this cost. ~210 MB compressed, ~713 MB on disk.
RUN python -m camoufox fetch

# Patch the Playwright Firefox driver's page-error NPE crash
# (`pageError.location.url` on an undefined location → the Node driver
# process exits → every subsequent call fails "Connection closed while
# reading from the driver"). Air Canada's redeem SPA reliably triggers it.
# See patch_playwright.py. Placed AFTER `camoufox fetch` so that expensive
# layer stays cached; the patch only touches the already-installed
# `playwright` package, so ordering is functionally irrelevant.
COPY patch_playwright.py ./
RUN python patch_playwright.py

COPY . .

# entrypoint.sh backgrounds userspace tailscaled + `tailscale up` (fail-safe,
# never blocks startup), then `exec`s uvicorn. See the script header.
RUN chmod +x ./entrypoint.sh

EXPOSE 8000
CMD ["./entrypoint.sh"]
