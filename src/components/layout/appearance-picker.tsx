"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
export type Appearance = "system" | "light" | "dark";
const eventName = "pointsnap:appearance";
function read() {
  return (document.documentElement.dataset.appearance ??
    "system") as Appearance;
}
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  return () => window.removeEventListener(eventName, callback);
}
function apply(theme: Appearance) {
  document.documentElement.dataset.appearance = theme;
  document.documentElement.classList.toggle(
    "dark",
    theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches),
  );
  window.dispatchEvent(new Event(eventName));
}
export function AppearancePicker() {
  const appearance = useSyncExternalStore(
    subscribe,
    read,
    () => "system" as Appearance,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => {
      if (read() === "system") apply("system");
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const Icon =
    appearance === "light" ? Sun : appearance === "dark" ? Moon : Monitor;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="header-icon" aria-label="Appearance preferences">
          <Icon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="appearance-popover">
        <p className="font-medium mb-2">Appearance</p>
        <div role="radiogroup" aria-label="Color theme">
          {(
            [
              ["system", "Use device setting", Monitor],
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
            ] as const
          ).map(([value, label, ItemIcon]) => (
            <label key={value} className="appearance-option">
              <input
                type="radio"
                name="appearance"
                className="sr-only"
                checked={appearance === value}
                onChange={() => {
                  document.cookie = `theme=${value}; path=/; max-age=31536000; samesite=lax`;
                  apply(value);
                }}
              />
              <ItemIcon className="size-4" />
              <span>{label}</span>
              {appearance === value && <Check className="size-4" />}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
