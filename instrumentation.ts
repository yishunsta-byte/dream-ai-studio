import { playbackRuntimeKey, type PlaybackRuntimeScope } from "./lib/public-showcase/playback-http-runtime";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const runtime = globalThis as PlaybackRuntimeScope;
    runtime[playbackRuntimeKey] = async request => {
      const [{ servePlayback }, { getPublicationPublicReaders }] = await Promise.all([
        import("./lib/public-showcase/playback-source"), import("./lib/public-showcase/publication-runtime"),
      ]);
      return servePlayback(request, async () => (await getPublicationPublicReaders()).coverSource);
    };
    const { getMenuConfigState } = await import("./lib/menus/server");
    const result = getMenuConfigState();
    if (!result.ok) {
      console.error("메뉴 설정 검증 실패:", result.issues);
    }
  }
}
