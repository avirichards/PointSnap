"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";
import type { Cabin, SearchQuery } from "@/lib/types";
import { AirportCombobox } from "./airport-combobox";

interface SearchFormProps {
  initialQuery: SearchQuery;
  onSubmit: (q: SearchQuery) => void;
  isStreaming?: boolean;
}

export function SearchForm({ initialQuery, onSubmit, isStreaming }: SearchFormProps) {
  const [origin, setOrigin] = useState(initialQuery.origin);
  const [dest, setDest] = useState(initialQuery.dest);
  const [departDate, setDepartDate] = useState(initialQuery.departDate);
  const [pax, setPax] = useState(initialQuery.pax);
  const [minCabin, setMinCabin] = useState<Cabin>(initialQuery.minCabin);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      origin: origin.toUpperCase().slice(0, 3),
      dest: dest.toUpperCase().slice(0, 3),
      departDate,
      pax,
      minCabin,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-2 md:grid-cols-[120px_120px_1fr_80px_120px_auto] gap-2 md:gap-3 items-end"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="origin" className="text-xs text-muted-foreground uppercase tracking-wider">
          From
        </Label>
        <AirportCombobox
          id="origin"
          value={origin}
          onChange={(iata) => setOrigin(iata)}
          placeholder="From"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="dest" className="text-xs text-muted-foreground uppercase tracking-wider">
          To
        </Label>
        <AirportCombobox
          id="dest"
          value={dest}
          onChange={(iata) => setDest(iata)}
          placeholder="To"
        />
      </div>
      <div className="grid gap-1.5 col-span-2 md:col-span-1">
        <Label htmlFor="depart" className="text-xs text-muted-foreground uppercase tracking-wider">
          Depart
        </Label>
        <Input
          id="depart"
          type="date"
          value={departDate}
          onChange={(e) => setDepartDate(e.target.value)}
          className="tabular-nums text-base"
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pax" className="text-xs text-muted-foreground uppercase tracking-wider">
          Pax
        </Label>
        <Input
          id="pax"
          type="number"
          min={1}
          max={9}
          value={pax}
          onChange={(e) => setPax(Math.max(1, Number(e.target.value)))}
          className="tabular-nums text-base"
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cabin" className="text-xs text-muted-foreground uppercase tracking-wider">
          Min cabin
        </Label>
        <select
          id="cabin"
          value={minCabin}
          onChange={(e) => setMinCabin(e.target.value as Cabin)}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="Y">Economy</option>
          <option value="W">Premium</option>
          <option value="J">Business</option>
          <option value="F">First</option>
        </select>
      </div>
      <Button
        type="submit"
        size="lg"
        className="col-span-2 md:col-span-1 h-11"
        disabled={isStreaming}
        aria-busy={isStreaming || undefined}
      >
        {isStreaming ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Search className="size-4" aria-hidden />
        )}
        {isStreaming ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}
