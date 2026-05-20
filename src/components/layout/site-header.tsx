"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun, Wallet, Sparkles, Search, Shield, LogIn, Star, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/sweet-spots", label: "Sweet spots", icon: Star },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/airlines", label: "My Airlines", icon: KeyRound },
  { href: "/admin", label: "Admin", icon: Shield },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
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

  const isActive = (href: string) =>
    href === "/search" ? pathname === "/" || pathname.startsWith("/search") : pathname.startsWith(href);

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
        <nav className="ml-auto flex items-center gap-1" aria-label="Primary">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Button
              key={href}
              variant={isActive(href) ? "secondary" : "ghost"}
              size="default"
              className="px-3 sm:px-4"
              asChild
            >
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                aria-label={label}
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            </Button>
          ))}
          <Button
            variant="outline"
            size="default"
            className="px-3 sm:px-4"
            asChild
          >
            <Link href="/sign-in" aria-label="Sign in">
              <LogIn className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sign in</span>
            </Link>
          </Button>
          <Toggle
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            pressed={isDark}
            onPressedChange={toggle}
            size="default"
          >
            {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </Toggle>
        </nav>
      </div>
    </header>
  );
}
