import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseQuery } from "../src/lib/award-search/query";
import type { SearchQuery } from "../src/lib/types";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import type { EtihadBrowserResult } from "./etihad";
import type { DeltaBrowserResult } from "./delta";
import type { SmilesBrowserResult } from "./smiles";
import type { SasBrowserResult } from "./sas";
import type { CopaBrowserResult } from "./copa";
import type { UnitedBrowserResult } from "./united";
import type { VirginBrowserResult } from "./virgin";
import type { QantasBrowserResult } from "./qantas";
import type { SouthwestBrowserResult } from "./southwest";

type SearchRunner = {
  search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<
    | AmericanBrowserResult
    | DeltaBrowserResult
    | SmilesBrowserResult
    | EtihadBrowserResult
    | SasBrowserResult
    | QantasBrowserResult
    | VirginBrowserResult
    | UnitedBrowserResult
    | CopaBrowserResult
    | SouthwestBrowserResult
  >;
  close(): Promise<void>;
};
type WorkerOptions = {
  token: string;
  concurrency?: number;
  timeoutMs?: number;
  evidenceDirectory?: string;
  deltaRunner?: SearchRunner;
  smilesRunner?: SearchRunner;
  etihadRunner?: SearchRunner;
  southwestRunner?: SearchRunner;
  sasRunner?: SearchRunner;
  virginRunner?: SearchRunner;
  unitedRunner?: SearchRunner;
  copaRunner?: SearchRunner;
  qantasRunner?: SearchRunner;
};

async function readQuery(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new BrowserSearchError("Expected a JSON search.", "request", 415);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > 2048)
      throw new BrowserSearchError(
        "Search request is too large.",
        "request",
        413,
      );
    chunks.push(Buffer.from(part));
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    const allowed = new Set([
      "origin",
      "dest",
      "departDate",
      "pax",
      "minCabin",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error();
    return parseQuery(
      new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])),
    );
  } catch {
    throw new BrowserSearchError(
      "Choose two airports, a valid future date and 1–9 adults.",
      "request",
      400,
    );
  }
}

export function createBrowserWorker(
  runner: SearchRunner,
  options: WorkerOptions,
) {
  if (options.token.length < 32)
    throw new Error(
      "A browser-worker token of at least 32 characters is required.",
    );
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const secret = digest(`Bearer ${options.token}`),
    concurrency = options.concurrency ?? 2,
    timeoutMs = options.timeoutMs ?? 95000;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new Error(
      "Browser concurrency must be 1–4 and timeout must be positive.",
    );
  let active = 0;
  const queue: (() => void)[] = [],
    requests = new Set<AbortController>();
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const record = async (value: unknown) => {
    if (!options.evidenceDirectory) return;
    try {
      await mkdir(options.evidenceDirectory, { recursive: true });
      await appendFile(
        resolve(options.evidenceDirectory, "searches.jsonl"),
        `${JSON.stringify(value)}\n`,
      );
    } catch {
      /* Diagnostics do not determine success. */
    }
  };
  const server = createServer(async (req, res) => {
    if (!timingSafeEqual(digest(req.headers.authorization ?? ""), secret)) {
      reply(res, 401, { message: "Browser service authentication required." });
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      reply(res, 200, {
        status: "ready",
        active,
        queued: queue.length,
        program: "AA_AADVANTAGE",
        programs: [
          "AA_AADVANTAGE",
          ...(options.deltaRunner ? ["DL_SKYMILES"] : []),
          ...(options.smilesRunner ? ["G3_GOL_SMILES"] : []),
          ...(options.etihadRunner ? ["EY_GUEST"] : []),
          ...(options.sasRunner ? ["SK_EUROBONUS"] : []),
          ...(options.qantasRunner ? ["QF_FF"] : []),
          ...(options.virginRunner ? ["VS_FLYING_CLUB"] : []),
          ...(options.unitedRunner ? ["UA_MP"] : []),
          ...(options.copaRunner ? ["CM_CONNECTMILES"] : []),
          ...(options.southwestRunner ? ["WN_RAPID_REWARDS"] : []),
        ],
      });
      return;
    }
    const selectedRunner =
      req.url === "/v1/search/virgin"
        ? options.virginRunner
        : req.url === "/v1/search/united"
          ? options.unitedRunner
          : req.url === "/v1/search/qantas"
            ? options.qantasRunner
            : req.url === "/v1/search/copa"
              ? options.copaRunner
              : req.url === "/v1/search/sas"
                ? options.sasRunner
                : req.url === "/v1/search/southwest"
                  ? options.southwestRunner
                  : req.url === "/v1/search/etihad"
                    ? options.etihadRunner
                    : req.url === "/v1/search/american"
                      ? runner
                      : req.url === "/v1/search/delta"
                        ? options.deltaRunner
                        : req.url === "/v1/search/smiles"
                          ? options.smilesRunner
                          : undefined;
    if (req.method !== "POST" || !selectedRunner) {
      reply(res, 404, { message: "Unknown browser search." });
      return;
    }
    const id = randomUUID(),
      started = Date.now(),
      cancel = new AbortController();
    const signal = AbortSignal.any([
      cancel.signal,
      AbortSignal.timeout(
        req.url === "/v1/search/united" ||
          req.url === "/v1/search/smiles" ||
          req.url === "/v1/search/copa" ||
          req.url === "/v1/search/qantas"
          ? (options.timeoutMs ?? 180000)
          : timeoutMs,
      ),
    ]);
    requests.add(cancel);
    res.on("close", () => {
      if (!res.writableEnded) cancel.abort();
    });
    let acquired = false,
      q: SearchQuery | undefined;
    try {
      q = await readQuery(req);
      if (active >= concurrency) {
        if (queue.length >= 8)
          throw new BrowserSearchError(
            "The browser search queue is full. Try again shortly.",
            "queue",
            429,
          );
        await new Promise<void>((resolveWait, reject) => {
          const wake = () => {
            signal.removeEventListener("abort", abort);
            // Reserve the freed slot synchronously. If this request is then
            // cancelled, finally releases it to the next waiting search.
            active++;
            acquired = true;
            resolveWait();
          };
          const abort = () => {
            const at = queue.indexOf(wake);
            if (at >= 0) queue.splice(at, 1);
            reject(
              new BrowserSearchError(
                "Browser search expired while waiting.",
                "queue",
                504,
              ),
            );
          };
          queue.push(wake);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      } else {
        active++;
        acquired = true;
      }
      signal.throwIfAborted();
      const result = await selectedRunner.search(q, signal);
      signal.throwIfAborted();
      await record({
        id,
        at: new Date().toISOString(),
        query: q,
        elapsedMs: Date.now() - started,
        result: "success",
        programId: result.programId,
        itineraries: result.itineraryCount,
        fares: result.fareCount,
        stages: result.stages,
      });
      reply(res, 200, result);
    } catch (error) {
      const known = error instanceof BrowserSearchError,
        status = known ? error.status : signal.aborted ? 504 : 502;
      const message = known
          ? error.message
          : "The browser search could not complete.",
        stage = known ? error.stage : "worker";
      await record({
        id,
        at: new Date().toISOString(),
        query: q,
        elapsedMs: Date.now() - started,
        result: "error",
        programId:
          req.url === "/v1/search/virgin"
            ? "VS_FLYING_CLUB"
            : req.url === "/v1/search/united"
              ? "UA_MP"
              : req.url === "/v1/search/qantas"
                ? "QF_FF"
                : req.url === "/v1/search/copa"
                  ? "CM_CONNECTMILES"
                  : req.url === "/v1/search/sas"
                    ? "SK_EUROBONUS"
                    : req.url === "/v1/search/southwest"
                      ? "WN_RAPID_REWARDS"
                      : req.url === "/v1/search/etihad"
                        ? "EY_GUEST"
                        : req.url === "/v1/search/smiles"
                          ? "G3_GOL_SMILES"
                          : req.url === "/v1/search/delta"
                            ? "DL_SKYMILES"
                            : "AA_AADVANTAGE",
        status,
        stage,
        message,
        ...(known ? error.evidence : {}),
      });
      reply(res, status, { message, stage, complete: false });
    } finally {
      requests.delete(cancel);
      if (acquired) {
        active--;
        queue.shift()?.();
      }
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return {
    server,
    close: async () => {
      for (const controller of requests) controller.abort();
      await runner.close();
      await options.deltaRunner?.close();
      await options.smilesRunner?.close();
      await options.etihadRunner?.close();
      await options.southwestRunner?.close();
      await options.sasRunner?.close();
      await options.virginRunner?.close();
      await options.unitedRunner?.close();
      await options.copaRunner?.close();
      await options.qantasRunner?.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
