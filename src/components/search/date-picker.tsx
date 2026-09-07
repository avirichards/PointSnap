"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  calendarDate,
  clampDate,
  dateLabel,
  monthDays,
  moveDate,
  moveMonth,
} from "@/lib/calendar";
interface Props {
  id: string;
  label: string;
  value?: string;
  onChange: (date: string | undefined) => void;
  min: string;
  max: string;
  optional?: boolean;
  flexibility: number;
  onFlexibilityChange: (days: number) => void;
}
export function DatePicker({
  id,
  label,
  value,
  onChange,
  min,
  max,
  optional,
  flexibility,
  onFlexibilityChange,
}: Props) {
  const [open, setOpen] = useState(false),
    [month, setMonth] = useState(value ?? min),
    [focused, setFocused] = useState(value ?? min);
  const grid = useRef<HTMLTableElement>(null),
    weeks = monthDays(month),
    initial = clampDate(value ?? min, min, max);
  function focusDate(next: string) {
    const bounded = clampDate(next, min, max);
    setFocused(bounded);
    setMonth(bounded);
    requestAnimationFrame(() =>
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${bounded}"]`)
        ?.focus(),
    );
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const delta: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    let next: string | undefined;
    if (event.key in delta) next = moveDate(date, delta[event.key]);
    if (event.key === "Home")
      next = moveDate(date, -calendarDate(date).getUTCDay());
    if (event.key === "End")
      next = moveDate(date, 6 - calendarDate(date).getUTCDay());
    if (event.key === "PageUp")
      next = moveMonth(date, event.shiftKey ? -12 : -1);
    if (event.key === "PageDown")
      next = moveMonth(date, event.shiftKey ? 12 : 1);
    if (next) {
      event.preventDefault();
      focusDate(next);
    }
  }
  return (
    <div className="search-date-field">
      <label htmlFor={id} className="search-field-label">
        {label}
      </label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setMonth(initial);
            setFocused(initial);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className="search-date-trigger"
            aria-label={`${label}: ${value ? dateLabel(value, { year: "numeric" }) : "Add return date"}`}
          >
            <span>
              {value ? dateLabel(value, { weekday: "short" }) : "Add return"}
            </span>
            {value ? (
              <CalendarDays aria-hidden className="size-4" />
            ) : (
              <Plus aria-hidden className="size-4" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="calendar-popover"
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()} date`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() =>
              grid.current
                ?.querySelector<HTMLButtonElement>(`[data-date="${initial}"]`)
                ?.focus(),
            );
          }}
        >
          <div className="calendar-heading">
            <button
              type="button"
              aria-label="Previous month"
              disabled={month.slice(0, 7) <= min.slice(0, 7)}
              onClick={() => focusDate(moveMonth(focused, -1))}
            >
              <ChevronLeft className="size-4" />
            </button>
            <span id={`${id}-month`} aria-live="polite">
              {dateLabel(month, {
                month: "long",
                year: "numeric",
                day: undefined,
              })}
            </span>
            <button
              type="button"
              aria-label="Next month"
              disabled={month.slice(0, 7) >= max.slice(0, 7)}
              onClick={() => focusDate(moveMonth(focused, 1))}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <table
            ref={grid}
            role="grid"
            aria-labelledby={`${id}-month`}
            className="calendar-grid"
          >
            <thead>
              <tr>
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((day) => (
                  <th key={day} scope="col">
                    <abbr title={day}>{day.slice(0, 2)}</abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, index) => (
                <tr key={index}>
                  {week.map((date) => (
                    <td
                      key={date}
                      role="gridcell"
                      aria-selected={date === value}
                    >
                      <button
                        type="button"
                        data-date={date}
                        tabIndex={date === focused ? 0 : -1}
                        disabled={date < min || date > max}
                        aria-label={dateLabel(date, {
                          weekday: "long",
                          month: "long",
                          year: "numeric",
                        })}
                        data-outside={date.slice(0, 7) !== month.slice(0, 7)}
                        className={date === value ? "is-selected" : ""}
                        onKeyDown={(event) => keyboard(event, date)}
                        onClick={() => {
                          onChange(date);
                          setOpen(false);
                        }}
                      >
                        {Number(date.slice(8))}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="calendar-footer">
            <label htmlFor={`${id}-exact`}>
              Enter a date
              <input
                id={`${id}-exact`}
                type="date"
                min={min}
                max={max}
                value={value ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next && next >= min && next <= max) {
                    onChange(next);
                    setMonth(next);
                    setFocused(next);
                  }
                }}
              />
            </label>
            {optional && value && (
              <button
                type="button"
                className="calendar-clear"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                <X className="size-3.5" /> Remove return
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <label className="date-flexibility" htmlFor={`${id}-flex`}>
        <span className="sr-only">{label} date flexibility</span>
        <select
          id={`${id}-flex`}
          disabled={!value}
          value={value ? flexibility : 0}
          onChange={(event) => onFlexibilityChange(Number(event.target.value))}
        >
          <option value={0}>{value ? "Exact date" : "Optional"}</option>
          {[1, 2, 3, 5, 7].map((days) => (
            <option key={days} value={days}>
              ± {days} {days === 1 ? "day" : "days"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
