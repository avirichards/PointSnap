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
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates xvfb \
    fonts-liberation fonts-noto-color-emoji \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdbus-glib-1-2 libdrm2 libgbm1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libpci3 libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 libxt6 libxtst6 \
    xdg-utils libu2f-udev libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

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

COPY . .

EXPOSE 8000
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8000"]
