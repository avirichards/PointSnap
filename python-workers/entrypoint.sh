#!/bin/sh
# PointSnap worker entrypoint.
#
# Purpose: start Tailscale in USERSPACE-NETWORKING mode as a STRICTLY
# ADDITIVE, FAIL-SAFE side-channel, then start the FastAPI app.
#
# Tailscale is needed for ONE thing only: the Air Canada Aeroplan award
# search. AC's air-bounds API is Kasada-protected and HTTP-429s any request
# from a data-center IP (the Fly worker's egress). Routing the AC Camoufox
# transport through a residential exit node (the user's home Mac, joined to
# the tailnet as an exit node) defeats that. Userspace mode exposes a local
# SOCKS5/HTTP proxy on 127.0.0.1:1055 that Camoufox points its `proxy=` at;
# every OTHER worker code path (other airlines, the DB, auth endpoints)
# keeps using Fly's normal egress untouched.
#
# FAIL-SAFE CONTRACT (non-negotiable — see CLAUDE.md / task brief):
#   * `tailscaled` and `tailscale up` run in the BACKGROUND. The script
#     NEVER blocks app startup on them.
#   * If TAILSCALE_AUTHKEY is unset, or tailscaled fails, or the exit node
#     is offline — this script STILL `exec`s uvicorn. The worker fully
#     serves /health, every other airline, and the auth endpoints. Only the
#     AC search degrades (it falls back to direct Fly egress, which Kasada
#     then 429s — degraded, not down).
#   * Userspace mode needs NO TUN device and NO NET_ADMIN capability, so it
#     cannot fail the container the way kernel-TUN mode would.

set -u

# ---------------------------------------------------------------------------
# Userspace Tailscale — best-effort, fully backgrounded, never fatal.
# ---------------------------------------------------------------------------
TS_SOCKS_PORT=1055   # 127.0.0.1:1055 — Camoufox AC transport points proxy= here

start_tailscale() {
  if [ -z "${TAILSCALE_AUTHKEY:-}" ]; then
    echo "[entrypoint] TAILSCALE_AUTHKEY unset — skipping Tailscale." \
         "AC search will use direct Fly egress (Kasada will 429 it)." >&2
    return 0
  fi

  mkdir -p /var/run/tailscale /var/lib/tailscale 2>/dev/null || true

  # tailscaled in userspace-networking mode: no TUN device, no NET_ADMIN.
  # --socks5-server + --outbound-http-proxy-listen on the SAME localhost
  # port expose the tunnel as a local proxy (per Tailscale's userspace
  # networking docs). Backgrounded; its failure cannot block the app.
  echo "[entrypoint] starting tailscaled (userspace, proxy on 127.0.0.1:${TS_SOCKS_PORT})" >&2
  /usr/local/bin/tailscaled \
    --tun=userspace-networking \
    --socks5-server="localhost:${TS_SOCKS_PORT}" \
    --outbound-http-proxy-listen="localhost:${TS_SOCKS_PORT}" \
    --state=/var/lib/tailscale/tailscaled.state \
    --socket=/var/run/tailscale/tailscaled.sock \
    >/tmp/tailscaled.log 2>&1 &

  # Bring up the tailnet + select the exit node, in the background, with a
  # bounded timeout so a hung `tailscale up` can never wedge startup. If
  # TAILSCALE_EXIT_NODE is set we route AC traffic out through it (the
  # user's home Mac); --exit-node-allow-lan-access keeps localhost/LAN
  # reachable so the userspace proxy itself still works.
  (
    EXIT_ARGS=""
    if [ -n "${TAILSCALE_EXIT_NODE:-}" ]; then
      EXIT_ARGS="--exit-node=${TAILSCALE_EXIT_NODE} --exit-node-allow-lan-access"
      echo "[entrypoint] tailscale up via exit node: ${TAILSCALE_EXIT_NODE}" >&2
    else
      echo "[entrypoint] TAILSCALE_EXIT_NODE unset — joining tailnet with no exit node" >&2
    fi
    # shellcheck disable=SC2086
    timeout 60 /usr/local/bin/tailscale up \
      --authkey="${TAILSCALE_AUTHKEY}" \
      --hostname=pointsnap-worker \
      --accept-dns=false \
      ${EXIT_ARGS} \
      >/tmp/tailscale-up.log 2>&1 \
      && echo "[entrypoint] tailscale up OK" >&2 \
      || echo "[entrypoint] tailscale up FAILED (AC search degrades to direct egress) — see /tmp/tailscale-up.log" >&2
  ) &

  return 0
}

# Run the Tailscale bring-up; `|| true` guarantees a non-zero exit here can
# never abort the script before the app starts.
start_tailscale || true

# ---------------------------------------------------------------------------
# Start the FastAPI app — UNCONDITIONALLY. This is the last line; `exec`
# replaces the shell with uvicorn (PID 1 signal handling stays correct).
# ---------------------------------------------------------------------------
echo "[entrypoint] starting uvicorn (FastAPI worker)" >&2
exec uvicorn serve:app --host 0.0.0.0 --port 8000
