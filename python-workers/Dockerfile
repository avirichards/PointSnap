FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive

# Patchright (stealth Playwright fork) needs Chromium + a bunch of native
# deps to render real browser pages. Install them in the base image so
# every scraper plugin has the option.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
    libxrandr2 xdg-utils libu2f-udev libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install \
    fastapi 'uvicorn[standard]' httpx 'psycopg[binary]' \
    python-dotenv json5 \
    patchright \
    selectolax \
    'curl-cffi>=0.7'

# Install Chromium for Patchright. --with-deps already covered above by
# apt; this just pulls the browser binary into ~/.cache/ms-playwright.
RUN patchright install chromium

COPY . .

EXPOSE 8000
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8000"]
