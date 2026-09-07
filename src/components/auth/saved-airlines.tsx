"use client";
import { useEffect, useState } from "react";
import { listConnectedPrograms, type ConnectedProgram } from "@/lib/api/auth";
import { PROGRAMS } from "@/lib/programs";
import { Button } from "@/components/ui/button";
export function SavedAirlines() {
  const [rows, setRows] = useState<ConnectedProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      const r = await listConnectedPrograms();
      if (!active) return;
      if (r.ok) setRows(r.data);
      else setError(r.message);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  async function disconnect(programId: string) {
    setBusy(programId);
    setError("");
    try {
      const r = await fetch("/api/auth/airline/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      });
      if (!r.ok)
        throw new Error(
          "Could not disconnect. Your saved data has not been confirmed deleted. Try again.",
        );
      setRows((old) => old.filter((r) => r.programId !== programId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="space-y-4" aria-label="Saved airline accounts">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading saved accounts…</p>
      ) : !rows.length && !error ? (
        <p className="text-muted-foreground">
          You have no saved airline accounts.
        </p>
      ) : (
        rows.map((r) => (
          <div
            key={r.programId}
            className="flex justify-between items-center gap-4 rounded-xl border bg-card p-5"
          >
            <div>
              <h2 className="font-semibold">
                {PROGRAMS.find((p) => p.id === r.programId)?.name ??
                  r.programId}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Session expires {new Date(r.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => disconnect(r.programId)}
            >
              {busy === r.programId ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        ))
      )}
    </section>
  );
}
