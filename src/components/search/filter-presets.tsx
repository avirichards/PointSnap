"use client";
import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  defaultFilters,
  type ResultFilters,
} from "@/lib/award-search/comparison";
import { CABIN_ORDER } from "@/lib/types";
import { Button } from "@/components/ui/button";
const key = "pointsnap:filter-presets:v2",
  event = "pointsnap:filter-presets";
const read = () => {
  try {
    return localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
};
const subscribe = (fn: () => void) => {
  window.addEventListener("storage", fn);
  window.addEventListener(event, fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener(event, fn);
  };
};
function normalize(value: unknown): ResultFilters | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>,
    base = defaultFilters();
  for (const key of Object.keys(base) as (keyof ResultFilters)[]) {
    const item = source[key];
    if (
      Array.isArray(base[key])
        ? Array.isArray(item) &&
          item.length <= 50 &&
          item.every((v) => typeof v === "string" && v.length <= 100)
        : typeof item === typeof base[key] &&
          (typeof item !== "string" || item.length <= 200)
    )
      Object.assign(base, { [key]: item });
  }
  base.cabins = base.cabins.filter((c) => CABIN_ORDER.includes(c));
  base.days = base.days.filter((d) => /^[0-6]$/.test(d));
  return base;
}
function decode(raw: string): { name: string; filters: ResultFilters }[] {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).flatMap((item) => {
      const f = normalize(item?.filters);
      return f && typeof item.name === "string" && item.name.length <= 40
        ? [{ name: item.name, filters: f }]
        : [];
    });
  } catch {
    return [];
  }
}
export function FilterPresets({
  filters,
  onApply,
}: {
  filters: ResultFilters;
  onApply: (f: ResultFilters) => void;
}) {
  const raw = useSyncExternalStore(subscribe, read, () => "[]"),
    items = decode(raw);
  const [name, setName] = useState(""),
    [notice, setNotice] = useState("");
  function write(next: typeof items) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(event));
      return true;
    } catch {
      setNotice("This browser could not save your presets.");
      return false;
    }
  }
  return (
    <div className="filter-presets space-y-3">
      <h3 className="font-medium text-sm">Your filter presets</h3>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const label = name.trim();
          if (!label) return;
          if (
            write(
              [
                { name: label, filters },
                ...items.filter((item) => item.name !== label),
              ].slice(0, 12),
            )
          ) {
            setNotice(`Saved “${label}” on this device.`);
            setName("");
          }
        }}
      >
        <input
          aria-label="Preset name"
          placeholder="e.g. Business, no overnight stops"
          maxLength={40}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 border rounded-lg p-2 bg-background text-sm"
        />
        <Button variant="outline" type="submit">
          Save
        </Button>
      </form>
      {items.map((item) => (
        <div key={item.name} className="flex items-center border rounded-lg">
          <button
            className="text-sm flex-1 text-left min-h-11 px-3"
            onClick={() => {
              onApply({ ...item.filters, feeCurrency: filters.feeCurrency });
              setNotice(`Applied “${item.name}”.`);
            }}
          >
            {item.name}
          </button>
          <button
            className="icon-button"
            aria-label={`Remove preset ${item.name}`}
            onClick={() => write(items.filter((i) => i.name !== item.name))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <button
        className="text-xs underline text-muted-foreground min-h-8"
        onClick={() => {
          try {
            const old = normalize(
              JSON.parse(
                localStorage.getItem("pointsnap:result-filters:v1") ?? "null",
              ),
            );
            if (old) {
              onApply({ ...old, feeCurrency: filters.feeCurrency });
              setNotice("Applied your previous saved filters.");
            } else setNotice("No previous saved filters found.");
          } catch {
            setNotice("Previous saved filters could not be read.");
          }
        }}
      >
        Load previous saved filters
      </button>
      <p className="text-xs text-muted-foreground">
        Saved on this device. A preset is only applied when you choose it.
      </p>
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
    </div>
  );
}
