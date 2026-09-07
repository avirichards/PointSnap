import { it, expect } from "vitest";
import { readEvents } from "../sse";
import type { AwardEvent } from "../types";
it("decodes fragmented UTF-8 and multiple CRLF SSE events", async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\n\r\ndata: {"type":"error","message":"JFK → LHR"}\r\n\r\ndata: {"type":"complete","durationMs":123}\n\n',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of bytes) c.enqueue(new Uint8Array([b]));
      c.close();
    },
  });
  const events: AwardEvent[] = [];
  await readEvents(stream, (e) => events.push(e));
  expect(events).toEqual([
    { type: "error", message: "JFK → LHR" },
    { type: "complete", durationMs: 123 },
  ]);
});
