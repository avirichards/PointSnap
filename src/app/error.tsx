"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main"
      className="min-h-[70vh] flex flex-col justify-center items-center gap-5 p-6 text-center"
    >
      <p className="mono-label">POINTSNAP</p>
      <h1 className="text-3xl font-semibold">This page couldn’t load.</h1>
      <p className="text-muted-foreground max-w-md">
        A service may be temporarily unavailable. Try again, or return to award
        search.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to search</Link>
        </Button>
      </div>
    </main>
  );
}
