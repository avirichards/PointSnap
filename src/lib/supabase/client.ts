"use client";
import { createBrowserClient } from "@supabase/ssr";
import { authConfigured } from "./config";
export function browserSupabase() {
  if (!authConfigured()) return null;
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
