import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authConfigured } from "./config";

export async function serverSupabase() {
  if (!authConfigured()) return null;
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) =>
              jar.set(name, value, options),
            );
          } catch {
            /* Server components are read-only; proxy refreshes cookies. */
          }
        },
      },
    },
  );
}

export async function currentUser() {
  const client = await serverSupabase();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

// app_metadata is only writable by the auth administrator, unlike user_metadata.
export async function currentStaff() {
  const user = await currentUser();
  return user?.app_metadata?.role === "staff" ? user : null;
}
