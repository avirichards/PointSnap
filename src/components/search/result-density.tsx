"use client";
import { useSyncExternalStore } from "react";
const key = "pointsnap:compact-results",
  event = "pointsnap:results-density-changed";
let fallback = true;
function read() {
  try {
    const saved = localStorage.getItem(key);
    return saved === "true" ? true : saved === "false" ? false : fallback;
  } catch {
    return fallback;
  }
}
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(event, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(event, notify);
  };
}
export function useCompactResults() {
  const compact = useSyncExternalStore(subscribe, read, () => true);
  return [
    compact,
    (next: boolean) => {
      fallback = next;
      try {
        localStorage.setItem(key, String(next));
      } catch {}
      window.dispatchEvent(new Event(event));
    },
  ] as const;
}
export function ResultDensityPicker() {
  const [compact, setCompact] = useCompactResults();
  return (
    <fieldset className="filter-fieldset">
      <legend>Results layout</legend>
      <div
        className="filter-segments"
        role="radiogroup"
        aria-label="Results layout"
      >
        {[
          [true, "Compact"],
          [false, "Roomy"],
        ].map(([value, label]) => (
          <label key={String(value)}>
            <input
              type="radio"
              name="results-density"
              className="peer sr-only"
              checked={compact === value}
              onChange={() => setCompact(value === true)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
