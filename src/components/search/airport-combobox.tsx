"use client";

/**
 * Airport autocomplete combobox. Wraps shadcn's `command` + `popover` to give
 * the search form a typeahead over the seeded ~5,400 airports.
 *
 * UX:
 *   - Trigger button styled like an Input (h-11, same border + radius).
 *   - Popover shows command palette: input + result list with IATA in mono +
 *     city in foreground + name in muted.
 *   - 150ms debounce on the query; AbortController cancels in-flight on input
 *     change. In-component cache (Map) for repeat queries.
 *   - Free-text fallback: typing a 3-letter code that doesn't match any row
 *     and pressing Enter commits it as-is — power users still type IATAs.
 *   - Accessible: aria-combobox on trigger, cmdk handles arrow nav + Enter +
 *     Esc + aria-activedescendant.
 */

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface AirportOption {
  iata: string;
  city: string;
  name: string;
  countryIso2: string;
  region: string;
}

interface AirportComboboxProps {
  id: string;
  value: string;
  onChange: (iata: string, opt: AirportOption | null) => void;
  placeholder?: string;
  className?: string;
  /** Initial label for `value` when no fetch has run yet (e.g. SSR initial state). */
  initialLabel?: string;
}

export function AirportCombobox({
  id,
  value,
  onChange,
  placeholder,
  className,
  initialLabel,
}: AirportComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AirportOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [labelByIata, setLabelByIata] = useState<Record<string, AirportOption>>(
    () => ({}),
  );
  const cacheRef = useRef(new Map<string, AirportOption[]>());
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch on query change.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      setLoading(false);
      return;
    }
    const cached = cacheRef.current.get(q.toLowerCase());
    if (cached) {
      setOptions(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const r = await fetch(
          `/api/airports?q=${encodeURIComponent(q)}&limit=10`,
          { signal: ac.signal },
        );
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        const data = (await r.json()) as AirportOption[];
        cacheRef.current.set(q.toLowerCase(), data);
        setOptions(data);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setOptions([]);
        }
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [query, open]);

  const display = useMemo(() => {
    if (!value) return null;
    const opt = labelByIata[value];
    if (opt) return `${value} · ${opt.city}`;
    if (initialLabel) return `${value} · ${initialLabel}`;
    return value;
  }, [value, labelByIata, initialLabel]);

  const commit = (iata: string, opt: AirportOption | null) => {
    if (opt) setLabelByIata((prev) => ({ ...prev, [iata]: opt }));
    onChange(iata, opt);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          className={cn(
            "flex h-11 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-base font-mono uppercase tabular-nums",
            "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left normal-case">
            {display ?? placeholder ?? "Search airports…"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]"
        align="start"
      >
        <Command
          shouldFilter={false}
          id={`${id}-listbox`}
          aria-label="Airport search results"
        >
          <CommandInput
            placeholder="IATA, city, or name…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              // Free-text fallback: 3-letter input with no matches → commit raw.
              if (
                e.key === "Enter" &&
                options.length === 0 &&
                /^[A-Za-z]{3}$/.test(query.trim())
              ) {
                e.preventDefault();
                commit(query.trim().toUpperCase(), null);
              }
            }}
          />
          <CommandList>
            {loading && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Searching…
              </div>
            )}
            {!loading && options.length === 0 && query.trim().length >= 2 && (
              <CommandEmpty>
                {/^[A-Za-z]{3}$/.test(query.trim())
                  ? `No match — press Enter to use "${query.trim().toUpperCase()}" anyway`
                  : "No airports match — try a different query"}
              </CommandEmpty>
            )}
            {options.length > 0 && (
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.iata}
                    value={o.iata}
                    onSelect={() => commit(o.iata, o)}
                  >
                    <span className="font-mono tabular-nums w-12 shrink-0">
                      {o.iata}
                    </span>
                    <span className="truncate">
                      {o.city}, {o.countryIso2}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground truncate hidden md:inline">
                      {o.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
