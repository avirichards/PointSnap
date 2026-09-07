"use client";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { MAX_DATE_FLEX_DAYS } from "@/lib/award-search/date-window";
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
    weeks = monthDays(month).filter((week) =>
      week.some((date) => date.slice(0, 7) === month.slice(0, 7)),
    ),
    initial = clampDate(value ?? min, min, max);
  const flexChoices = [0, 1, 3, 7, MAX_DATE_FLEX_DAYS];
  // Keep an older saved search's chosen range visible without changing its meaning.
  if (!flexChoices.includes(flexibility)) flexChoices.push(flexibility);
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
      <CalendarPopup
        title={`Choose ${label.toLowerCase()} date`}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setMonth(initial);
            setFocused(initial);
          }
        }}
        trigger={
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
        }
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
                  <td key={date} role="gridcell" aria-selected={date === value}>
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
                        setFocused(date);
                        setMonth(date);
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
          <fieldset className="calendar-flexibility" disabled={!value}>
            <legend>
              <span className="sr-only">{label} </span>Date flexibility
            </legend>
            <div className="calendar-flex-options">
              {flexChoices.map((days) => (
                <label key={days}>
                  <input
                    className="sr-only"
                    type="radio"
                    name={`${id}-flex`}
                    value={days}
                    aria-label={
                      days === 0
                        ? "Exact date"
                        : `± ${days} ${days === 1 ? "day" : "days"}`
                    }
                    checked={(value ? flexibility : 0) === days}
                    onChange={() => onFlexibilityChange(days)}
                  />
                  <span>{days === 0 ? "Exact date" : `±${days}`}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="calendar-flexibility-hint" aria-live="polite">
            {!value
              ? "Choose a date to add flexibility."
              : flexibility
                ? `Up to ${2 * flexibility + 1} dates · ${flexibility} ${flexibility === 1 ? "day" : "days"} before and after`
                : "Search only your selected date."}
          </p>
          <div className="calendar-actions">
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
            <button
              type="button"
              className="calendar-done"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      </CalendarPopup>
      <span className="date-flexibility">
        {!value
          ? "Optional"
          : flexibility
            ? `± ${flexibility} ${flexibility === 1 ? "day" : "days"}`
            : "Exact date"}
      </span>
    </div>
  );
}

const compactQuery = "(max-width: 640px)";
function watchCompact(listener: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function CalendarPopup({
  open,
  onOpenChange,
  title,
  trigger,
  onOpenAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger: ReactNode;
  onOpenAutoFocus: (event: Event) => void;
  children: ReactNode;
}) {
  const compact = useSyncExternalStore(
    watchCompact,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  if (compact)
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="calendar-overlay" />
          <Dialog.Content
            className="calendar-popover calendar-sheet"
            aria-describedby={undefined}
            onOpenAutoFocus={onOpenAutoFocus}
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="calendar-popover"
        role="dialog"
        aria-label={title}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
