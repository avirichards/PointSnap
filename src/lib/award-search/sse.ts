import type { AwardEvent } from "./types";
/** Handles arbitrary UTF-8 chunks, CRLF, comments and multiple frames. */
export async function readEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: AwardEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) onEvent(JSON.parse(data) as AwardEvent);
      }
      if (buffer.length > 8_000_000) throw new Error("Response too large.");
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
