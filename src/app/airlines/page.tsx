import Link from "next/link";
import { ArrowUpRight, Check, Globe2 } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { PROGRAMS } from "@/lib/programs";
import { providerCoverage } from "@/lib/award-search/engine";
import { bookingUrl } from "@/lib/bookingHandoff";
import { workerConfigured } from "@/lib/worker";
export const dynamic = "force-dynamic";
export const metadata = { title: "Programs — PointSnap" };
export default function ProgramsPage() {
  const enabled = providerCoverage();
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="search-workspace">
        <p className="eyebrow">YOUR SEARCH COVERAGE</p>
        <h1 className="text-3xl font-semibold tracking-tight mt-3">
          A world of programs.
          <br />
          <span className="text-muted-foreground">One place to compare.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          {enabled.length} program connections are enabled. Availability depends
          on the route, date, and cabin. Every search shows which programs
          responded.
        </p>
        <div className="mt-6 rounded-xl border bg-card p-5 flex items-start gap-3">
          <Globe2 className="size-5 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Alaska returns individual flights. JetBlue and Virgin Atlantic
            return daily award prices; you choose the exact flight with the
            airline. Programs without a data connection can be searched on their
            official sites.
          </p>
        </div>
        <section
          aria-label="Program coverage"
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-7"
        >
          {[...PROGRAMS]
            .sort(
              (a, b) =>
                Number(enabled.includes(b.id)) -
                  Number(enabled.includes(a.id)) ||
                a.name.localeCompare(b.name),
            )
            .map((p) => (
              <article
                key={p.id}
                className="rounded-xl border bg-card p-5 flex flex-col gap-4"
              >
                <div className="flex items-center gap-3">
                  <span className="airline-tile">{p.iata}</span>
                  <h2 className="font-semibold">{p.name}</h2>
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  {enabled.includes(p.id) ? (
                    <>
                      <Check className="size-4 text-primary" />
                      Search connection enabled
                    </>
                  ) : (
                    <>Data connection needed</>
                  )}
                </p>
                <a
                  className="text-sm font-medium inline-flex items-center gap-1 mt-auto hover:underline"
                  href={bookingUrl(p.id, {
                    origin: "",
                    dest: "",
                    departDate: "",
                    pax: 1,
                    minCabin: "Y",
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open airline website <ArrowUpRight className="size-3.5" />
                </a>
              </article>
            ))}
        </section>
        {workerConfigured() && (
          <p className="mt-8 text-sm text-muted-foreground">
            Previously saved an airline login?{" "}
            <Link href="/airlines/accounts" className="underline">
              Manage saved accounts
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
