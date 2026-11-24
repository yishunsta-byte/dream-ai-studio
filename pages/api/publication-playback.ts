import type { NextApiRequest, NextApiResponse } from "next";
import { once } from "node:events";

import { parsePlaybackPath } from "@/lib/public-showcase/playback-path";
import { playbackRuntimeKey, type PlaybackRuntimeScope } from "@/lib/public-showcase/playback-http-runtime";

// The App Router strips Content-Length, including verified range and HEAD lengths.
// A Node response retains the verified framing and aborts incomplete transfers.
export const config = { api: { bodyParser: false, responseLimit: false } };
export default async function playback(req: NextApiRequest, res: NextApiResponse) {
  const path = req.headers["x-dream-playback-path"];
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-type", "text/plain; charset=utf-8");
  if (typeof path !== "string" || !parsePlaybackPath(path)) return res.status(404).end();
  const run = (globalThis as PlaybackRuntimeScope)[playbackRuntimeKey];
  if (!run) return res.status(503).end();
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  res.once("close", disconnect);
  try {
    const headers = new Headers();
    for (const key of ["range", "if-range"]) {
      const value = req.headers[key];
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const request = new Request(new URL(path, "http://localhost"), { method: req.method, headers, signal: controller.signal });
    const response = await run(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) { res.end(); return; }
    for await (const bytes of response.body) {
      controller.signal.throwIfAborted();
      if (!res.write(bytes)) await once(res, "drain", { signal: controller.signal });
    }
    res.end();
  } catch {
    if (!res.headersSent && !res.destroyed) {
      res.removeHeader("content-length");
      res.removeHeader("content-range");
      res.status(503).end();
    } else res.destroy();
  } finally {
    controller.abort();
    res.off("close", disconnect);
  }
}
