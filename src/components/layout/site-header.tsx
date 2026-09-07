"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bookmark,
  Compass,
  LogIn,
  Radar,
  Search,
  WalletCards,
} from "lucide-react";
import { browserSupabase } from "@/lib/supabase/client";
import { AppearancePicker } from "./appearance-picker";
const NAV_ITEMS = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/sweet-spots", label: "Explore", icon: Compass },
  { href: "/trips", label: "My trips", icon: Bookmark },
  { href: "/wallet", label: "My points", icon: WalletCards },
];
export function SiteHeader() {
  const pathname = usePathname();
  const [account, setAccount] = useState<{
    email: string;
    isStaff: boolean;
  } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/account", { signal: c.signal, cache: "no-store" })
      .then((r) => r.json())
      .then(setAccount)
      .catch(() => {});
    return () => c.abort();
  }, []);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/search" className="brand" aria-label="PointSnap home">
          <Radar aria-hidden />
          <span>PointSnap</span>
        </Link>
        <nav aria-label="Primary" className="primary-nav">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/search"
                ? pathname === "/" ||
                  pathname.startsWith("/search") ||
                  pathname === "/design-preview"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
              >
                <Icon aria-hidden className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="header-actions">
          {account?.isStaff && (
            <Link className="header-coverage" href="/admin">
              Admin
            </Link>
          )}
          <Link className="header-coverage" href="/airlines">
            Programs
          </Link>
          <AppearancePicker />
          {account ? (
            <button
              className="header-account"
              onClick={async () => {
                const result = await browserSupabase()?.auth.signOut();
                if (!result?.error) window.location.assign("/");
              }}
            >
              Sign out
            </button>
          ) : (
            <Link href="/sign-in" className="header-account">
              <LogIn aria-hidden className="size-4" />
              <span>Sign in</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
