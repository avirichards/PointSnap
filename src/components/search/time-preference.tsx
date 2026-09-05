"use client";
import { useSyncExternalStore } from "react";
import { formatLocalTime, type TimeFormat } from "@/lib/time-format";
const key = "pointsnap:time-format",
  changed = "pointsnap:time-format-changed";
let fallback: TimeFormat = "12h";
function read(): TimeFormat {
  try {
    const saved = localStorage.getItem(key);
    return saved === "24h" || saved === "12h" ? saved : fallback;
  } catch {
    return fallback;
  }
}
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(changed, notify);
  };
}
export function useTimeFormat() {
  const format = useSyncExternalStore(subscribe, read, () => "12h" as const);
  const setFormat = (value: TimeFormat) => {
    fallback = value;
    try {
      localStorage.setItem(key, value);
    } catch {}
    window.dispatchEvent(new Event(changed));
  };
  return {
    format,
    setFormat,
    time: (value: string | null | undefined) => formatLocalTime(value, format),
  };
}
export function TimeFormatPicker() {
  const { format, setFormat } = useTimeFormat();
  return (
    <fieldset className="filter-fieldset">
      <legend>Time format</legend>
      <div
        className="filter-segments"
        role="radiogroup"
        aria-label="Time format"
      >
        {[
          ["12h", "12-hour", "1:30 PM"],
          ["24h", "24-hour", "13:30"],
        ].map(([value, label, example]) => (
          <label key={value}>
            <input
              type="radio"
              name="display-time-format"
              checked={format === value}
              onChange={() => setFormat(value as TimeFormat)}
              className="peer sr-only"
            />
            <span>
              {label}
              <small className="block text-xs text-muted-foreground">
                {example}
              </small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { format } = useTimeFormat();
  const hour = value ? Number(value.slice(0, 2)) : null,
    minute = value ? value.slice(3, 5) : "00";
  function update(h: number, m: string) {
    onChange(`${String(h).padStart(2, "0")}:${m}`);
  }
  return (
    <fieldset className="filter-field">
      <legend className="mb-2">{label}</legend>
      <div className="time-field">
        <select
          aria-label={`${label} hour`}
          value={
            hour === null
              ? ""
              : format === "12h"
                ? String(hour % 12 || 12)
                : String(hour)
          }
          onChange={(e) => {
            if (!e.target.value) {
              onChange("");
              return;
            }
            const selected = Number(e.target.value);
            update(
              format === "12h"
                ? (selected % 12) + (hour !== null && hour >= 12 ? 12 : 0)
                : selected,
              minute,
            );
          }}
        >
          <option value="">Any</option>
          {Array.from({ length: format === "12h" ? 12 : 24 }, (_, i) =>
            format === "12h" ? i + 1 : i,
          ).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span aria-hidden="true">:</span>
        <select
          aria-label={`${label} minute`}
          value={minute}
          disabled={hour === null}
          onChange={(e) => update(hour ?? 0, e.target.value)}
        >
          {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map(
            (m) => (
              <option key={m}>{m}</option>
            ),
          )}
        </select>
        {format === "12h" && (
          <select
            aria-label={`${label} AM or PM`}
            value={hour !== null && hour >= 12 ? "PM" : "AM"}
            disabled={hour === null}
            onChange={(e) =>
              update(
                ((hour ?? 0) % 12) + (e.target.value === "PM" ? 12 : 0),
                minute,
              )
            }
          >
            <option>AM</option>
            <option>PM</option>
          </select>
        )}
      </div>
    </fieldset>
  );
}
