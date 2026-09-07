import Link from "next/link";
import { ArrowRight } from "lucide-react";
export default function NotFound() {
  return (
    <main
      id="main"
      className="min-h-[70vh] flex flex-col justify-center items-center gap-5 p-6 text-center"
    >
      <p className="mono-label">POINTSNAP / 404</p>
      <h1 className="text-3xl font-semibold">A little off route.</h1>
      <p className="text-muted-foreground">We couldn’t find that page.</p>
      <Link href="/" className="inline-flex items-center gap-2 text-primary">
        Back to award search <ArrowRight className="size-4" />
      </Link>
    </main>
  );
}
