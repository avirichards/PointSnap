"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserSupabase } from "@/lib/supabase/client";
import { safeNext } from "@/lib/auth-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccountForm({ signup = false }: { signup?: boolean }) {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    params.get("error")
      ? "This sign-in link expired. Request a new one below."
      : "",
  );
  const client = browserSupabase();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const magic =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "magic";
    setBusy(true);
    setMessage("");
    try {
      const next = safeNext(params.get("next"));
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const result = magic
        ? await client.auth.signInWithOtp({
            email,
            options: { emailRedirectTo, shouldCreateUser: signup },
          })
        : signup
          ? await client.auth.signUp({
              email,
              password,
              options: { emailRedirectTo },
            })
          : await client.auth.signInWithPassword({ email, password });
      if (result.error) {
        setMessage(result.error.message);
        return;
      }
      if ("session" in result.data && result.data.session)
        window.location.assign(next);
      else
        setMessage(
          "Check your email for a secure sign-in link. You can close this page.",
        );
    } catch {
      setMessage("We could not reach sign-in. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      id="main"
      tabIndex={-1}
      className="min-h-screen grid place-items-center px-4 py-12"
    >
      <div className="w-full max-w-md space-y-6">
        <Link href="/" className="font-semibold text-xl">
          PointSnap
        </Link>
        <section className="rounded-xl border bg-card p-6 space-y-5">
          <h1 className="text-2xl font-semibold">
            {signup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-muted-foreground">
            Your points wallet and award searches, in one place. No personal
            airline login needed.
          </p>
          {!client && (
            <p role="status" className="rounded-lg border p-3 text-sm">
              Account services are not configured on this installation yet. You
              can still search and compare programs.
            </p>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={!client || busy}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">
                Password {signup && "(12 or more characters)"}
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 12 : 1}
                disabled={!client || busy}
                className="h-11"
              />
            </div>
            <Button
              className="w-full h-11"
              disabled={!client || busy}
              type="submit"
            >
              {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
            </Button>
            <Button
              className="w-full h-11"
              variant="outline"
              type="submit"
              value="magic"
              disabled={!client || busy}
            >
              Email me a sign-in link
            </Button>
            <p className="text-sm text-muted-foreground">
              Forgot your password? Use a sign-in link instead.
            </p>
            {message && (
              <p role="status" className="text-sm rounded-md bg-muted p-3">
                {message}
              </p>
            )}
          </form>
          <Link
            className="text-sm underline underline-offset-4"
            href={`${signup ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(safeNext(params.get("next")))}`}
          >
            {signup
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </Link>
        </section>
        <Link href="/" className="text-sm text-muted-foreground">
          ← Back to search
        </Link>
      </div>
    </main>
  );
}
