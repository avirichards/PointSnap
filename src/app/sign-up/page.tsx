import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = {
  title: "Sign up — PointSnap",
  description: "Create your PointSnap account.",
};

const CLERK_CONFIGURED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function SignUpPage() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-gradient-to-b from-background via-background to-muted/30 focus:outline-none"
    >
      <Link
        href="/search"
        className="flex items-center gap-2 mb-8 text-base font-semibold tracking-tight"
      >
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-5" aria-hidden />
        </span>
        PointSnap
      </Link>

      <div className="w-full max-w-sm rounded-xl border bg-card shadow-sm p-6 space-y-5">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="text-sm text-muted-foreground">
            Free at launch — start tracking points, watch routes, and get
            alerted when sweet spots open.
          </p>
        </div>

        {!CLERK_CONFIGURED && (
          <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Auth backend not yet wired (Phase 1 mid-build). This form is a
            visual placeholder — submission is a no-op for now.
          </div>
        )}

        <form className="space-y-4" action="/search" method="get">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              required
              className="h-11"
              disabled={!CLERK_CONFIGURED}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 12 characters"
              minLength={12}
              required
              className="h-11"
              disabled={!CLERK_CONFIGURED}
            />
            <p className="text-xs text-muted-foreground">
              Use 12+ characters with a mix of letters, numbers, and symbols.
            </p>
          </div>
          <Button
            type="submit"
            className="w-full h-11"
            disabled={!CLERK_CONFIGURED}
          >
            Create account
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center pt-1">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-foreground hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        <Link href="/search" className="hover:text-foreground">
          ← Back to search
        </Link>
      </p>
    </main>
  );
}
