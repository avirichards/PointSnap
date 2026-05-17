"use client";

import Link from "next/link";
import { Moon, Sun, Wallet, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { useEffect, useState } from "react";

export function SiteHeader() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const initial = document.documentElement.classList.contains("dark");
    setIsDark(initial);
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.cookie = `theme=${next ? "dark" : "light"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-3 md:px-6">
        <Link href="/search" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-4" aria-hidden />
          </span>
          PointSnap
          <span className="hidden sm:inline text-xs font-normal text-muted-foreground">
            the points cockpit
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/search">
              <Sparkles className="size-4" aria-hidden />
              Search
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild disabled>
            <Link href="/wallet" aria-disabled>
              <Wallet className="size-4" aria-hidden />
              <span className="hidden sm:inline">Wallet</span>
            </Link>
          </Button>
          <Toggle
            aria-label="Toggle theme"
            pressed={isDark}
            onPressedChange={toggle}
            size="sm"
          >
            {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </Toggle>
        </nav>
      </div>
    </header>
  );
}
