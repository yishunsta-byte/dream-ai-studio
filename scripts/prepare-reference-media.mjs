import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.env.VERCEL) {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Reference analysis requires the Linux x64 build environment.");

  const release = "autobuild-2026-11-19-12-39";
  const base = "ffmpeg-n8.1.3-36-ge22a4510c9-linux64-lgpl-shared-8.1";
  const url = `https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/${release}/${base}.tar.xz`;
  const digest = "9a85898c7ded6b82c3c26732bd869c7bd078e5a593174a5ce29a1f4c48bfe826";
  const root = resolve("node_modules/.dream-reference-media");
  const temp = await mkdtemp(join(tmpdir(), "dream-reference-media-"));
  try {
    const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error("Unable to download the reference-analysis tools.");
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length !== 65_969_160 || createHash("sha256").update(archive).digest("hex") !== digest) {
      throw new Error("The reference-analysis tools did not match the pinned archive.");
    }
    const downloaded = join(temp, "ffmpeg.tar.xz");
    await writeFile(downloaded, archive);
    await mkdir(root, { recursive: true });
    execFileSync("tar", ["-xJf", downloaded, "-C", root, "--strip-components=1", `${base}/bin/ffmpeg`, `${base}/bin/ffprobe`, `${base}/lib`]);
    await rm(join(root, "lib", "pkgconfig"), { recursive: true, force: true });
    for (const name of ["ffmpeg", "ffprobe"]) {
      const bin = join(root, "bin", name);
      await rename(bin, `${bin}.bin`);
      await writeFile(bin, `#!/bin/sh\nset -eu\nroot="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec env -i PATH=/usr/bin:/bin LD_LIBRARY_PATH="$root/lib" "$root/bin/${name}.bin" "$@"\n`, { mode: 0o755 });
      execFileSync(bin, ["-version"], { timeout: 10_000, stdio: "ignore" });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
