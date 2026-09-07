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
const rotationSpeed = 0.00135; // Degrees per millisecond.
function subscribeMotion(listener: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
export function RouteGlobe({
  origin,
  destination,
  onDestination,
  showLabels = true,
}: {
  origin: string;
  destination: string;
  onDestination?: (iata: string) => void;
  showLabels?: boolean;
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [focusedAirport, setFocusedAirport] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    () => true,
  );
  const drag = useRef<{
    x: number;
    y: number;
    offset: [number, number];
    lastX: number;
    lastY: number;
    lastAt: number;
    velocity: [number, number];
  } | null>(null);
  const coast = useRef<[number, number]>([rotationSpeed, 0]);
  const elapsedRef = useRef(0);
  useEffect(() => {
    if (reducedMotion) return;
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
      if (!drag.current) {
        // Frame-independent damping blends the throw back into automatic rotation.
        const decay = Math.exp(-step / 950);
        const [vx, vy] = coast.current;
        const dx =
          rotationSpeed * step + (vx - rotationSpeed) * 950 * (1 - decay);
        const dy = vy * 950 * (1 - decay);
        coast.current = [
          rotationSpeed + (vx - rotationSpeed) * decay,
          vy * decay,
        ];
        setOffset((old) => [
          old[0] + dx,
          Math.max(-75 - center[1], Math.min(75 - center[1], old[1] + dy)),
        ]);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, center]);
  const [hover, setHover] = useState("");
  const view: [number, number] = [
    ((((center[0] + offset[0] + 180) % 360) + 360) % 360) - 180,
    Math.max(-75, Math.min(75, center[1] + offset[1])),
  ];
  const projection = geoOrthographic()
    .rotate([-view[0], -view[1], 0])
    .scale(214)
    .translate([300, 260])
    .clipAngle(90);
  const path = geoPath(projection);
  const visible = AIRPORTS.filter(
    (a) => hubs.includes(a.iata) || a.iata === origin || a.iata === destination,
  ).filter((a) => geoDistance(coordinates(a), view) < Math.PI / 2 - 0.025);
  const focusedIsVisible = visible.some((a) => a.iata === focusedAirport);
  useEffect(() => {
    // Rotation keeps running. Return focus to the stable globe before a
    // focused marker leaves the visible hemisphere, instead of losing it.
    if (focusedAirport && !focusedIsVisible)
      svgRef.current?.focus({ preventScroll: true });
  }, [focusedAirport, focusedIsVisible]);
  const markers =
    focusedAirport && !focusedIsVisible
      ? [...visible, ...AIRPORTS.filter((a) => a.iata === focusedAirport)]
      : visible;
  const routes = useMemo(() => {
    const pairs: [[string, string], ...[string, string][]] = [
      [origin, destination],
      ["JFK", "LHR"],
      ["JFK", "LAX"],
      ["SEA", "SFO"],
      ["LHR", "DXB"],
      ["DXB", "SIN"],
      ["SIN", "SYD"],
      ["HND", "LAX"],
      ["SFO", "HNL"],
      ["GRU", "LHR"],
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
  const labels = new Set(showLabels ? [origin, destination, hover] : []);
  const labelPositions = new Map<string, { x: number; y: number }>();
  for (const code of labels) {
    const a = markers.find((marker) => marker.iata === code);
    if (!a) continue;
    const [x, y] = projection(coordinates(a))!;
    const preferredX = x > 385 ? x - 130 : x + 14;
    const preferredY = y + (code === origin ? -40 : 10);
    const candidates = [0, 50, -50, 100, -100].flatMap((shift) =>
      [preferredX, x > 385 ? x + 14 : x - 130].map((horizontal) => ({
        x: Math.max(8, Math.min(474, horizontal)),
        y: Math.max(8, Math.min(470, preferredY + shift)),
      })),
    );
    const position =
      candidates.find((candidate) =>
        [...labelPositions.values()].every(
          (placed) =>
            candidate.x + 124 <= placed.x ||
            placed.x + 124 <= candidate.x ||
            candidate.y + 48 <= placed.y ||
            placed.y + 48 <= candidate.y,
        ),
      ) ?? candidates[0];
    labelPositions.set(code, position);
  }
  return (
    <div className="route-globe">
      <div className="globe-coordinate mono-label">
        AWARD ROUTE EXPLORER{" "}
        <span>
          {view[1].toFixed(1)}° {view[0].toFixed(1)}°
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 600 520"
        className="globe-svg"
        role="group"
        aria-label={`Interactive route globe, ${origin} to ${destination}. Drag or use arrow keys to rotate.${onDestination ? " Airport markers choose your destination." : ""}`}
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
            const d = delta[e.key];
            coast.current = [rotationSpeed, 0];
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
          coast.current = [0, 0];
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            offset,
            lastX: e.clientX,
            lastY: e.clientY,
            lastAt: e.timeStamp,
            velocity: [0, 0],
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const d = drag.current;
            const scale = 600 / e.currentTarget.getBoundingClientRect().width;
            const dt = Math.max(1, e.timeStamp - d.lastAt);
            const blend = 1 - Math.exp(-dt / 35);
            const vx = Math.max(
              -0.18,
              Math.min(0.18, (-(e.clientX - d.lastX) * scale * 0.28) / dt),
            );
            const vy = Math.max(
              -0.12,
              Math.min(0.12, ((e.clientY - d.lastY) * scale * 0.28) / dt),
            );
            d.velocity = [
              d.velocity[0] + (vx - d.velocity[0]) * blend,
              d.velocity[1] + (vy - d.velocity[1]) * blend,
            ];
            d.lastX = e.clientX;
            d.lastY = e.clientY;
            d.lastAt = e.timeStamp;
            setOffset([
              d.offset[0] - (e.clientX - d.x) * scale * 0.28,
              Math.max(
                -75 - center[1],
                Math.min(
                  75 - center[1],
                  d.offset[1] + (e.clientY - d.y) * scale * 0.28,
                ),
              ),
            ]);
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          coast.current =
            d && !reducedMotion && e.timeStamp - d.lastAt < 100
              ? d.velocity
              : [rotationSpeed, 0];
          drag.current = null;
        }}
        onPointerCancel={() => {
          coast.current = [rotationSpeed, 0];
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          if (drag.current) coast.current = [rotationSpeed, 0];
          drag.current = null;
        }}
      >
        <defs>
          <radialGradient id={`${uid}ocean`} cx="36%" cy="25%" r="78%">
            <stop offset="0" stopColor="var(--globe-ocean-top)" />
            <stop offset=".55" stopColor="var(--globe-ocean-mid)" />
            <stop offset="1" stopColor="var(--globe-ocean-edge)" />
          </radialGradient>
          <radialGradient id={`${uid}land`} cx="30%" cy="20%" r="90%">
            <stop offset="0" stopColor="var(--globe-land-top)" />
            <stop offset=".55" stopColor="var(--globe-land-mid)" />
            <stop offset="1" stopColor="var(--globe-land-edge)" />
          </radialGradient>
          <radialGradient id={`${uid}shade`} cx="32%" cy="28%" r="72%">
            <stop
              offset=".35"
              stopColor="var(--globe-shadow)"
              stopOpacity="0"
            />
            <stop
              offset=".83"
              stopColor="var(--globe-shadow)"
              stopOpacity="var(--globe-shadow-mid)"
            />
            <stop
              offset="1"
              stopColor="var(--globe-shadow)"
              stopOpacity="var(--globe-shadow-edge)"
            />
          </radialGradient>
          <radialGradient id={`${uid}halo`}>
            <stop offset=".78" stopColor="var(--globe-halo)" stopOpacity="0" />
            <stop offset=".9" stopColor="var(--globe-halo)" stopOpacity=".1" />
            <stop offset="1" stopColor="var(--globe-halo)" stopOpacity="0" />
          </radialGradient>
          <filter id={`${uid}glow`}>
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle cx="300" cy="260" r={241} fill={`url(#${uid}halo)`} />
        <path
          d={path({ type: "Sphere" }) ?? ""}
          fill={`url(#${uid}ocean)`}
          stroke="var(--globe-rim)"
          strokeOpacity=".5"
          strokeWidth=".7"
        />
        <path
          d={path(grid) ?? ""}
          fill="none"
          stroke="var(--globe-grid)"
          strokeOpacity=".13"
          strokeWidth=".55"
        />
        <path
          d={path(land) ?? ""}
          fill={`url(#${uid}land)`}
          stroke="var(--globe-shore)"
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
                stroke="var(--globe-route-edge)"
                strokeWidth="3"
                strokeLinecap="round"
                opacity=".55"
              />
              <path
                d={trail}
                fill="none"
                stroke="#f8fbf7"
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
        {markers.map((a) => {
          const [x, y] = projection(coordinates(a))!;
          const selected = a.iata === origin || a.iata === destination;
          const label = labelPositions.get(a.iata);
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
                setFocusedAirport(a.iata);
              }}
              onBlur={() => {
                setHover("");
                setFocusedAirport("");
              }}
            >
              <circle r="14" fill="transparent" />
              <circle
                r={selected ? 8 : 3}
                fill="var(--globe-marker)"
                opacity={selected ? 0.12 : 0.25}
              />
              <circle
                r={selected ? 3.7 : 1.8}
                fill={
                  selected
                    ? "var(--globe-marker-selected)"
                    : "var(--globe-marker)"
                }
              />
              {label && (
                <line
                  x1="0"
                  y1="0"
                  x2={Math.max(label.x, Math.min(x, label.x + 118)) - x}
                  y2={Math.max(label.y, Math.min(y, label.y + 42)) - y}
                  stroke="var(--globe-label-border)"
                  strokeWidth=".7"
                  opacity=".6"
                  pointerEvents="none"
                />
              )}
              {label && (
                <g
                  transform={`translate(${label.x - x},${label.y - y})`}
                  pointerEvents="none"
                >
                  <rect
                    width="118"
                    height="42"
                    rx="5"
                    fill="var(--globe-label)"
                    stroke="var(--globe-label-border)"
                  />
                  <circle cx="13" cy="21" r="2" fill="var(--globe-label-dot)" />
                  <text
                    x="24"
                    y="18"
                    fill="var(--globe-label-ink)"
                    fontSize="11"
                    fontWeight="500"
                  >
                    {a.city}
                  </text>
                  <text
                    x="24"
                    y="32"
                    fill="var(--globe-label-muted)"
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
    </div>
  );
}
