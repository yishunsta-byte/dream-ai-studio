import "server-only";

import type { resolveServerAuth } from "../auth/resolve";
import type { PrivateStorageOptions } from "../storage/supabase/config";
import type { openIsolatedStudioAnalysisAuthorityStore } from "./studio-analysis-authority-store";
import type { createStudioAnalysisPost } from "./studio-analysis-http";
import type { loadStudioRegisteredAnalysisPage } from "./studio-registered-analysis-page";

type PageConnection = NonNullable<NonNullable<Parameters<typeof loadStudioRegisteredAnalysisPage>[0]>["connection"]>;
type PostOptions = NonNullable<Parameters<typeof createStudioAnalysisPost>[0]>;
type Authority = Readonly<{
  listAnalyzableMaterials: PageConnection["listAnalyzableMaterials"];
} & Pick<PostOptions, "resolveRegisteredSource" | "analyzeRegisteredSource">>;

/** Both operations must use the same current ownership, registration and analysis eligibility policy. */
export function createStudioAnalysisConnection(authority?: Partial<Authority>) {
  const { listAnalyzableMaterials, resolveRegisteredSource, analyzeRegisteredSource } = authority ?? {};
  if (typeof listAnalyzableMaterials !== "function") return undefined;
  const post = typeof analyzeRegisteredSource === "function" && resolveRegisteredSource === undefined
    ? { analyzeRegisteredSource: analyzeRegisteredSource.bind(authority) }
    : typeof resolveRegisteredSource === "function" && analyzeRegisteredSource === undefined
      ? { resolveRegisteredSource: resolveRegisteredSource.bind(authority) }
      : undefined;
  if (!post) return undefined;

  return Object.freeze({
    page: Object.freeze({ analysisApiConnected: true, listAnalyzableMaterials: listAnalyzableMaterials.bind(authority) }),
    post: Object.freeze(post),
  });
}

type IsolatedConnectionOptions = Readonly<{
  authority: Omit<NonNullable<Parameters<typeof openIsolatedStudioAnalysisAuthorityStore>[0]>, "bucket" | "maxBytes">;
  storage: PrivateStorageOptions & { profile: "synthetic" };
  resolveAuth: typeof resolveServerAuth;
}>;

/** For an explicitly injected loopback fixture. Keep the materials loader off the HTML/RSC render path. */
export async function createIsolatedStudioAnalysisConnection(options?: IsolatedConnectionOptions) {
  if (!options || typeof options.resolveAuth !== "function" || options.storage?.profile !== "synthetic") return;
  const { authority, resolveAuth } = options;
  const { privateStorageConfig } = await import("../storage/supabase/config");
  let storage: PrivateStorageOptions;
  try { storage = privateStorageConfig(options.storage); }
  catch { return; }

  const { openIsolatedStudioAnalysisAuthorityStore } = await import("./studio-analysis-authority-store");
  const { createIsolatedVerifiedStorageAnalysis } = await import("./studio-verified-storage-analysis");
  const { loadStudioRegisteredAnalysisPage } = await import("./studio-registered-analysis-page");
  const { createIsolatedStudioMaterialsGet } = await import("./studio-protected-materials-get");
  const store = await openIsolatedStudioAnalysisAuthorityStore({ ...authority, bucket: storage.bucket, maxBytes: storage.maxBytes });
  if (!store) return;

  try {
    const analyze = createIsolatedVerifiedStorageAnalysis({ storage: { ...storage, profile: "synthetic" }, resolveAuth, readAuthority: store.readAuthority });
    const page = { analysisApiConnected: true, listAnalyzableMaterials: store.listAnalyzableMaterials };
    return Object.freeze({
      loadMaterials: () => loadStudioRegisteredAnalysisPage({ connection: page, resolveAuth }),
      getMaterials: createIsolatedStudioMaterialsGet({ resolveAuth, readMaterialSnapshots: store.readMaterialSnapshots }),
      post: Object.freeze({
        resolveAuth,
        analyzeRegisteredSource: (actor, selection, signal) => analyze(selection, signal, actor),
      } satisfies PostOptions),
      close: store.close,
    });
  } catch {
    await store.close().catch(() => {});
    return;
  }
}

// A verified production authority must be wired here for both entry points together.
export const studioAnalysisConnection = createStudioAnalysisConnection();
