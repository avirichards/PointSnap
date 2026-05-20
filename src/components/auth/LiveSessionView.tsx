/**
 * Phase 2.5 — LiveSessionView
 *
 * Renders the worker's live BD-browser screenshot stream onto a `<canvas>`
 * and forwards the user's mouse + keyboard input back to the remote
 * browser. This is the "live view" the user logs in through.
 *
 * Why a canvas + stream (not an iframe): Bright Data's hosted DevTools
 * inspector — the only "live view" URL BD exposes — is served with
 * `X-Frame-Options: DENY`, so it cannot be embedded cross-origin. The
 * worker instead captures ~3 fps JPEG frames over CDP and replays input
 * over CDP. See `python-workers/auth/capture.py` `_bd_inspector_url`.
 *
 * Transport:
 *  - Frames in:  EventSource on `/api/auth/airline/stream?sessionId=...`
 *    (SSE). Each `data:` line is `{t:"frame",b64,w,h}` | `{t:"url",url}` |
 *    `{t:"state",state}` | `{t:"bye",reason}`.
 *  - Input out:  batched POST to `/api/auth/airline/input?sessionId=...`.
 *
 * HIG choices (per `apple-hig` skill):
 *  - The canvas is the visual anchor — it fills the available space and
 *    preserves the remote browser's 4:2.25-ish aspect ratio (letterboxed
 *    on a muted surface so it never distorts).
 *  - Loading feedback: an explicit "connecting" overlay until the first
 *    frame lands (HIG: show progress for anything over ~1s).
 *  - Focus affordance: the canvas is keyboard-focusable; a subtle ring +
 *    a one-line hint tell the user to click into the view to type. Without
 *    focus, keystrokes would go nowhere — so we make the requirement
 *    visible rather than letting it fail silently.
 *  - Color independence: connection state uses an icon + text, not color
 *    alone.
 *  - Reduced motion: the only animation is the connecting spinner, which
 *    uses the same `animate-spin` the rest of the modal uses; frame
 *    repaints are content, not decorative motion.
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Loader2, MousePointerClick, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Same-origin SSE stream URL from `/auth/start` (`liveViewUrl`). */
  streamUrl: string;
  /** Opaque worker session id — used to address the `/input` endpoint. */
  sessionId: string;
  /** Remote browser pixel dimensions; canvas maps clicks into this space. */
  viewport: { w: number; h: number };
}

/** One input event in the shape the worker's `_dispatch_input` expects. */
type InputEvent =
  | {
      kind: "mouse";
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      x: number;
      y: number;
      button?: "left" | "middle" | "right";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | {
      kind: "key";
      type: "keyDown" | "keyUp" | "char";
      key?: string;
      code?: string;
      text?: string;
      keyCode?: number;
      modifiers?: number;
    }
  | { kind: "text"; text: string };

type ConnState = "connecting" | "live" | "ended";

/** Flush queued input at most this often (ms) — coalesces mousemoves. */
const INPUT_FLUSH_MS = 45;

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
function modifierMask(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (e.altKey ? 1 : 0) |
    (e.ctrlKey ? 2 : 0) |
    (e.metaKey ? 4 : 0) |
    (e.shiftKey ? 8 : 0)
  );
}

/** DOM `MouseEvent.button` (0/1/2) → CDP button name. */
function cdpButton(button: number): "left" | "middle" | "right" {
  return button === 2 ? "right" : button === 1 ? "middle" : "left";
}

/**
 * Decode a base64 string to a JPEG Blob.
 *
 * We decode the bytes directly with `atob` rather than round-tripping
 * through `fetch("data:image/jpeg;base64,...")` — a ~260 KB frame makes a
 * ~350 KB data URL, and browsers cap data-URL length (Chrome silently
 * truncated frames to ~10 KB, producing corrupt half-decoded images). A
 * direct byte decode has no length limit.
 */
function base64ToJpegBlob(b64: string): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

export function LiveSessionView({ streamUrl, sessionId, viewport }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [focused, setFocused] = useState(false);

  // Pending input events, flushed on a timer so rapid mousemoves coalesce
  // into one POST instead of hundreds.
  const queueRef = useRef<InputEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The latest decoded frame, painted on rAF so a burst of frames doesn't
  // thrash the canvas.
  const pendingBitmapRef = useRef<ImageBitmap | HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Actual decoded-frame dimensions. The worker pins the remote browser to
  // `viewport` (DPR 1) so this normally equals `viewport` — but we track
  // the real frame size as the source of truth for click-coordinate
  // mapping, so a viewport mismatch can never misplace clicks.
  const frameDimsRef = useRef<{ w: number; h: number }>({
    w: viewport.w,
    h: viewport.h,
  });

  /** Queue one input event for the next flush. */
  const enqueue = useCallback((ev: InputEvent) => {
    const q = queueRef.current;
    // Coalesce consecutive mouse-moves — only the latest position matters.
    if (
      ev.kind === "mouse" &&
      ev.type === "mouseMoved" &&
      q.length > 0 &&
      q[q.length - 1].kind === "mouse" &&
      (q[q.length - 1] as { type: string }).type === "mouseMoved"
    ) {
      q[q.length - 1] = ev;
    } else {
      q.push(ev);
    }
  }, []);

  // ---- Input flush loop -------------------------------------------------
  useEffect(() => {
    const flush = () => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const batch = q.splice(0, q.length);
      // Fire-and-forget — input lag is tolerable, a failed batch isn't
      // worth blocking the next one.
      void fetch(
        `/api/auth/airline/input?sessionId=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch }),
          keepalive: true,
        },
      ).catch(() => {
        /* swallow — best-effort input */
      });
    };
    flushTimerRef.current = setInterval(flush, INPUT_FLUSH_MS);
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      flush(); // best-effort final flush
    };
  }, [sessionId]);

  // ---- Frame stream (SSE) ----------------------------------------------
  useEffect(() => {
    // Reset to "connecting" whenever the stream target changes (a re-open
    // with a fresh session). Done inside the effect body so it stays
    // paired with the EventSource lifecycle below — same sanctioned
    // pattern as ConnectAirlineModal's open/programId reset. The initial
    // mount is a no-op (useState already starts at "connecting").
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnState("connecting");
    const es = new EventSource(streamUrl);
    let closed = false;

    const paint = () => {
      rafRef.current = null;
      const bmp = pendingBitmapRef.current;
      const canvas = canvasRef.current;
      if (!bmp || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Track the real frame size — keep the canvas's intrinsic resolution
      // matched to the decoded frame so it never up/down-samples, and so
      // click-coordinate mapping uses the true dimensions.
      const fw = bmp.width;
      const fh = bmp.height;
      if (fw && fh) {
        frameDimsRef.current = { w: fw, h: fh };
        if (canvas.width !== fw) canvas.width = fw;
        if (canvas.height !== fh) canvas.height = fh;
      }
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if ("close" in bmp && typeof bmp.close === "function") {
        // ImageBitmap — free it after drawing.
        (bmp as ImageBitmap).close();
      }
      pendingBitmapRef.current = null;
    };

    const onFrame = async (b64: string) => {
      try {
        const blob = base64ToJpegBlob(b64);
        const bitmap =
          "createImageBitmap" in window
            ? await createImageBitmap(blob)
            : await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = URL.createObjectURL(blob);
              });
        if (closed) {
          if ("close" in bitmap) (bitmap as ImageBitmap).close();
          return;
        }
        pendingBitmapRef.current = bitmap;
        if (connState !== "live") setConnState("live");
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(paint);
        }
      } catch {
        /* drop a bad frame; the next one repaints */
      }
    };

    es.onmessage = (msg) => {
      if (closed) return;
      let data: { t?: string; b64?: string; reason?: string };
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (data.t === "frame" && data.b64) {
        void onFrame(data.b64);
      } else if (data.t === "bye") {
        setConnState("ended");
        es.close();
      }
      // "url" / "state" events are consumed by the modal's status poll —
      // LiveSessionView only needs frames + the stream's own lifecycle.
    };

    es.onerror = () => {
      // EventSource auto-reconnects on a transient drop; only treat it as
      // ended if the worker explicitly closed (browser will stop retrying
      // once the connection is in CLOSED state).
      if (es.readyState === EventSource.CLOSED) {
        setConnState("ended");
      }
    };

    return () => {
      closed = true;
      es.close();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const bmp = pendingBitmapRef.current;
      if (bmp && "close" in bmp && typeof bmp.close === "function") {
        (bmp as ImageBitmap).close();
      }
      pendingBitmapRef.current = null;
    };
    // connState intentionally omitted — including it would re-open the
    // EventSource on every connecting→live transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl]);

  // ---- Coordinate mapping ----------------------------------------------
  /** Map a DOM pointer event to remote-browser CSS-pixel coordinates.
   *
   * The worker pins the remote browser to DPR 1, so the decoded frame's
   * pixels equal the remote browser's CSS pixels — which is exactly the
   * coordinate space CDP `Input.dispatchMouseEvent` expects. We scale from
   * the on-screen canvas rect into that frame space using the *actual*
   * decoded frame dimensions (frameDimsRef), not the assumed viewport.
   */
  const toRemoteCoords = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      const { w, h } = frameDimsRef.current;
      const sx = w / rect.width;
      const sy = h / rect.height;
      return {
        x: Math.max(0, Math.min(w, (e.clientX - rect.left) * sx)),
        y: Math.max(0, Math.min(h, (e.clientY - rect.top) * sy)),
      };
    },
    [],
  );

  // ---- Mouse handlers ---------------------------------------------------
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = toRemoteCoords(e);
      enqueue({ kind: "mouse", type: "mouseMoved", x, y });
    },
    [toRemoteCoords, enqueue],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      canvasRef.current?.focus();
      const { x, y } = toRemoteCoords(e);
      enqueue({
        kind: "mouse",
        type: "mousePressed",
        x,
        y,
        button: cdpButton(e.button),
        clickCount: e.detail || 1,
        modifiers: modifierMask(e),
      });
    },
    [toRemoteCoords, enqueue],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = toRemoteCoords(e);
      enqueue({
        kind: "mouse",
        type: "mouseReleased",
        x,
        y,
        button: cdpButton(e.button),
        clickCount: e.detail || 1,
        modifiers: modifierMask(e),
      });
    },
    [toRemoteCoords, enqueue],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const { x, y } = toRemoteCoords(e);
      enqueue({
        kind: "mouse",
        type: "mouseWheel",
        x,
        y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      });
    },
    [toRemoteCoords, enqueue],
  );

  // ---- Keyboard handlers ------------------------------------------------
  // We send keyDown + keyUp for every key, and additionally a `char` event
  // for printable characters so text input lands reliably across the
  // remote browser's input model.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Keep keystrokes in the remote browser — don't let them trigger
      // cockpit shortcuts or scroll the modal.
      e.preventDefault();
      e.stopPropagation();
      const mods = modifierMask(e);
      enqueue({
        kind: "key",
        type: "keyDown",
        key: e.key,
        code: e.code,
        keyCode: e.keyCode || e.which,
        modifiers: mods,
      });
      // A single printable character (not a chord) → emit the text.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        enqueue({
          kind: "key",
          type: "char",
          key: e.key,
          text: e.key,
          modifiers: mods,
        });
      }
    },
    [enqueue],
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      enqueue({
        kind: "key",
        type: "keyUp",
        key: e.key,
        code: e.code,
        keyCode: e.keyCode || e.which,
        modifiers: modifierMask(e),
      });
    },
    [enqueue],
  );

  // Paste — send the clipboard text as a bulk insert (CDP Input.insertText)
  // so the user can paste a password / 2FA code.
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      if (text) enqueue({ kind: "text", text });
    },
    [enqueue],
  );

  return (
    <div
      ref={wrapRef}
      className="relative flex flex-1 min-h-0 items-center justify-center bg-muted/30"
    >
      {/* The remote browser, painted onto a canvas. The canvas's intrinsic
          width/height are kept matched to each decoded frame (see `paint`),
          so its aspect ratio follows the real remote browser; `max-w/h-full`
          scales it down to fit the modal without distortion. */}
      <canvas
        ref={canvasRef}
        width={viewport.w}
        height={viewport.h}
        tabIndex={0}
        role="application"
        aria-label="Airline login — interactive remote browser. Click to focus, then type your credentials."
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          "max-h-full max-w-full object-contain outline-none",
          "shadow-sm transition-[box-shadow]",
          // Focus ring — the canvas MUST have focus to receive keystrokes,
          // so the focus state is a load-bearing affordance, not decoration.
          focused
            ? "ring-2 ring-[color:var(--color-primary)] ring-offset-0"
            : "ring-1 ring-border",
          connState !== "live" && "opacity-0",
        )}
        style={{ cursor: "default" }}
      />

      {/* Connecting overlay — shown until the first frame lands. */}
      {connState === "connecting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
            Connecting to the secure browser… the airline&rsquo;s login page
            will appear here in a moment.
          </p>
        </div>
      )}

      {/* Ended overlay — the worker closed the stream (captured/expired). */}
      {connState === "ended" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8 bg-muted/60">
          <WifiOff className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
            The live session has closed.
          </p>
        </div>
      )}

      {/* Focus hint — only while live and not yet focused. A passive,
          dismissible-by-action nudge; never blocks interaction. */}
      {connState === "live" && !focused && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-foreground/85 px-3 py-1.5 text-xs text-background shadow-md">
          <MousePointerClick className="size-3.5" aria-hidden />
          <span>Click the page, then type your login</span>
        </div>
      )}
    </div>
  );
}
