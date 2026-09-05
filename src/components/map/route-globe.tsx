"use client";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  geoDistance,
  geoGraticule10,
  geoInterpolate,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/land-110m.json";
import { Minus, Plus, LocateFixed, Move, Pause, Play } from "lucide-react";
import { AIRPORTS } from "@/db/seed/airports";
const topology = world as unknown as Parameters<typeof feature>[0];
const land = feature(topology, topology.objects.land);
const grid = geoGraticule10();
const hubs = [
  "SEA",
  "SFO",
  "LAX",
  "JFK",
  "ORD",
  "MIA",
  "YVR",
  "LHR",
  "CDG",
  "AMS",
  "FRA",
  "MAD",
  "DXB",
  "DOH",
  "HND",
  "NRT",
  "SIN",
  "HKG",
  "SYD",
  "AKL",
  "JNB",
  "GRU",
  "HNL",
];
const airport = (code: string) => AIRPORTS.find((a) => a.iata === code);
const coordinates = (a: (typeof AIRPORTS)[number]): [number, number] => [
  a.lonMicro / 1e6,
  a.latMicro / 1e6,
];
export function routeDistance(origin: string, destination: string) {
  const a = airport(origin),
    b = airport(destination);
  return a && b
    ? Math.round(geoDistance(coordinates(a), coordinates(b)) * 3958.7613)
    : null;
}
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(listener: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
export function RouteGlobe({
  origin,
  destination,
  onDestination,
}: {
  origin: string;
  destination: string;
  onDestination?: (iata: string) => void;
}) {
  const uid = useId().replaceAll(":", "");
  const from = airport(origin),
    to = airport(destination);
  const center = useMemo<[number, number]>(
    () =>
      from && to
        ? geoInterpolate(coordinates(from), coordinates(to))(0.5)
        : [-50, 30],
    [from, to],
  );
  const [offset, setOffset] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    () => true,
  );
  const animating = playing && !reducedMotion;
  const elapsedRef = useRef(0);
  useEffect(() => {
    if (!animating) return;
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!last) {
        last = now;
        return;
      }
      const delta = now - last;
      if (delta < 1000 / 30) return;
      last = now;
      if (document.hidden) return;
      const step = Math.min(delta, 80);
      elapsedRef.current += step;
      setElapsed(elapsedRef.current);
      setOffset((old) => [old[0] + step * 0.00135, old[1]]);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating]);
  const [hover, setHover] = useState("");
  const drag = useRef<{
    x: number;
    y: number;
    offset: [number, number];
  } | null>(null);
  const view: [number, number] = [
    center[0] + offset[0],
    Math.max(-75, Math.min(75, center[1] + offset[1])),
  ];
  const projection = geoOrthographic()
    .rotate([-view[0], -view[1], 0])
    .scale(214 * zoom)
    .translate([300, 260])
    .clipAngle(90);
  const path = geoPath(projection);
  const visible = AIRPORTS.filter(
    (a) => hubs.includes(a.iata) || a.iata === origin || a.iata === destination,
  ).filter((a) => geoDistance(coordinates(a), view) < Math.PI / 2 - 0.025);
  const routes = useMemo(() => {
    const pairs: [[string, string], ...[string, string][]] = [
      [origin, destination],
      ["JFK", "LHR"],
      ["JFK", "LAX"],
      ["SEA", "SFO"],
    ];
    const seen = new Set<string>();
    return pairs.flatMap(([a, b], index) => {
      const start = airport(a),
        end = airport(b),
        key = [a, b].sort().join("-");
      if (!start || !end || a === b || seen.has(key)) return [];
      seen.add(key);
      return [
        {
          key,
          active: index === 0,
          interpolate: geoInterpolate(coordinates(start), coordinates(end)),
        },
      ];
    });
  }, [origin, destination]);
  const labels = new Set([origin, destination, hover]);
  const control =
    "inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className="route-globe">
      <div className="globe-coordinate mono-label">
        AWARD ROUTE EXPLORER{" "}
        <span>
          {view[1].toFixed(1)}° {view[0].toFixed(1)}°
        </span>
      </div>
      <svg
        viewBox="0 0 600 520"
        className="globe-svg"
        role="group"
        aria-label={`Interactive route globe, ${origin} to ${destination}. Drag or use arrow keys to rotate. Airport markers choose your destination.`}
        tabIndex={0}
        onKeyDown={(e) => {
          const delta: { [key: string]: [number, number] } = {
            ArrowLeft: [-12, 0],
            ArrowRight: [12, 0],
            ArrowUp: [0, 10],
            ArrowDown: [0, -10],
          };
          if (delta[e.key]) {
            e.preventDefault();
            setPlaying(false);
            const d = delta[e.key];
            setOffset((old) => [old[0] + d[0], old[1] + d[1]]);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); // Drag the map without selecting SVG labels or focusing its box.
          const selection = window.getSelection();
          if (
            selection?.anchorNode &&
            e.currentTarget.contains(selection.anchorNode)
          )
            selection.removeAllRanges();
          setPlaying(false);
          drag.current = { x: e.clientX, y: e.clientY, offset };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const d = drag.current;
            const scale = 600 / e.currentTarget.getBoundingClientRect().width;
            setOffset([
              d.offset[0] - (e.clientX - d.x) * scale * 0.28,
              d.offset[1] + (e.clientY - d.y) * scale * 0.28,
            ]);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <radialGradient id={`${uid}ocean`} cx="36%" cy="25%" r="78%">
            <stop offset="0" stopColor="#213f46" />
            <stop offset=".55" stopColor="#102b31" />
            <stop offset="1" stopColor="#061116" />
          </radialGradient>
          <radialGradient id={`${uid}land`} cx="30%" cy="20%" r="90%">
            <stop offset="0" stopColor="#60897e" />
            <stop offset=".55" stopColor="#35574f" />
            <stop offset="1" stopColor="#132d2c" />
          </radialGradient>
          <radialGradient id={`${uid}shade`} cx="32%" cy="28%" r="72%">
            <stop offset=".35" stopColor="#000" stopOpacity="0" />
            <stop offset=".83" stopColor="#000" stopOpacity=".18" />
            <stop offset="1" stopColor="#000" stopOpacity=".75" />
          </radialGradient>
          <radialGradient id={`${uid}halo`}>
            <stop offset=".78" stopColor="#87d9c6" stopOpacity="0" />
            <stop offset=".9" stopColor="#67d8c0" stopOpacity=".1" />
            <stop offset="1" stopColor="#67d8c0" stopOpacity="0" />
          </radialGradient>
          <filter id={`${uid}glow`}>
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle cx="300" cy="260" r={241 * zoom} fill={`url(#${uid}halo)`} />
        <path
          d={path({ type: "Sphere" }) ?? ""}
          fill={`url(#${uid}ocean)`}
          stroke="#7ea79d"
          strokeOpacity=".5"
          strokeWidth=".7"
        />
        <path
          d={path(grid) ?? ""}
          fill="none"
          stroke="#8bd4c0"
          strokeOpacity=".13"
          strokeWidth=".55"
        />
        <path
          d={path(land) ?? ""}
          fill={`url(#${uid}land)`}
          stroke="#8fb7a3"
          strokeOpacity=".36"
          strokeWidth=".55"
        />
        <path d={path({ type: "Sphere" }) ?? ""} fill={`url(#${uid}shade)`} />
        {routes.map((route, index) => {
          const phase = (elapsed / 8000 + index * 0.29) % 1;
          const head = route.interpolate(phase);
          const point = projection(head);
          const front = geoDistance(head, view) < Math.PI / 2 - 0.01;
          const full =
            path({
              type: "LineString",
              coordinates: [route.interpolate(0), route.interpolate(1)],
            }) ?? "";
          const trail =
            path({
              type: "LineString",
              coordinates: Array.from({ length: 18 }, (_, i) =>
                route.interpolate(
                  Math.max(0, phase - 0.2) + (Math.min(0.2, phase) * i) / 17,
                ),
              ),
            }) ?? "";
          return (
            <g
              key={route.key}
              pointerEvents="none"
              opacity={route.active ? 1 : 0.43}
            >
              <path
                d={full}
                fill="none"
                stroke="#dce9e8"
                strokeWidth={route.active ? 1 : 0.7}
                opacity=".3"
              />
              <path
                d={trail}
                fill="none"
                stroke="#f0ffff"
                strokeWidth="6"
                opacity=".38"
                filter={`url(#${uid}glow)`}
              />
              <path
                d={trail}
                fill="none"
                stroke="#e6f5f6"
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity=".9"
              />
              {front && point && (
                <g transform={`translate(${point[0]},${point[1]})`}>
                  <circle
                    r="7"
                    fill="#f2ffff"
                    opacity=".35"
                    filter={`url(#${uid}glow)`}
                  />
                  <circle r="2.4" fill="#fff" />
                  <circle r=".8" fill="#fff" />
                </g>
              )}
            </g>
          );
        })}
        {visible.map((a) => {
          const [x, y] = projection(coordinates(a))!;
          const selected = a.iata === origin || a.iata === destination;
          const label = labels.has(a.iata);
          const left = x > 385;
          return (
            <g
              key={a.iata}
              transform={`translate(${x},${y})`}
              role={onDestination ? "button" : undefined}
              tabIndex={onDestination ? 0 : undefined}
              aria-label={`${a.city}, ${a.iata}${a.iata === origin ? ", departure airport" : ", set as destination"}`}
              className="globe-airport"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (a.iata !== origin) onDestination?.(a.iata);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (a.iata !== origin) onDestination?.(a.iata);
                }
              }}
              onMouseEnter={() => setHover(a.iata)}
              onMouseLeave={() => setHover("")}
              onFocus={() => {
                setHover(a.iata);
                setPlaying(false);
              }}
              onBlur={() => setHover("")}
            >
              <circle r="14" fill="transparent" />
              <circle
                r={selected ? 8 : 3}
                fill="#b8f3d6"
                opacity={selected ? 0.12 : 0.25}
              />
              <circle
                r={selected ? 3.7 : 1.8}
                fill={selected ? "#d5ffe8" : "#83b5a6"}
              />
              {label && (
                <g
                  transform={`translate(${left ? -130 : 14},${a.iata === origin ? -40 : 10})`}
                  pointerEvents="none"
                >
                  <rect
                    width="118"
                    height="42"
                    rx="5"
                    fill="#0b1719"
                    stroke="#3b5b54"
                  />
                  <circle cx="13" cy="21" r="2" fill="#b8f3d6" />
                  <text
                    x="24"
                    y="18"
                    fill="#e9f3ee"
                    fontSize="11"
                    fontWeight="500"
                  >
                    {a.city}
                  </text>
                  <text
                    x="24"
                    y="32"
                    fill="#8faaa0"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {a.iata}
                    {a.iata === origin
                      ? " / ORIGIN"
                      : a.iata === destination
                        ? " / DEST"
                        : ""}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="globe-controls">
        <button
          className={control}
          aria-label={
            animating ? "Pause globe animation" : "Play globe animation"
          }
          aria-pressed={animating}
          disabled={reducedMotion}
          title={
            reducedMotion
              ? "Animation follows your reduced-motion preference"
              : animating
                ? "Pause rotation and routes"
                : "Resume rotation and routes"
          }
          onClick={() => setPlaying(!playing)}
        >
          {animating ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </button>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Move className="size-3" />
          Drag to explore
        </span>
        <span className="h-4 border-l mx-2" />
        <button
          className={control}
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.8, z - 0.1))}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          className={control}
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(1.2, z + 0.1))}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          className={control}
          aria-label="Center on selected route"
          onClick={() => {
            setOffset([0, 0]);
            setZoom(1);
          }}
        >
          <LocateFixed className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
