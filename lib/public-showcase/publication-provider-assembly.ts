import "server-only";

import type { AdminPublicationStore } from "./admin-publication-service";
import { COVER_SOURCE } from "./cover-source";
import { createPublicationShowcaseConnection } from "./publication-showcase-connection";
import { SHOWCASE_SOURCE } from "./showcase-source";

type PublicReaders = Awaited<ReturnType<typeof createPublicationShowcaseConnection>>;
type Close = () => Promise<void>;

type Options = Readonly<{
  approvedTarget: string;
  openAdmin: () => Promise<Readonly<{ verifiedTarget: string; store: AdminPublicationStore; close: Close }>>;
  openPublic: () => Promise<PublicReaders & Readonly<{
    verifiedListTarget: string;
    verifiedCoverTarget: string;
    close: Close;
  }>>;
}>;

const inactive = Object.freeze({
  mode: "inactive" as const,
  adminStore: null,
  showcaseSource: SHOWCASE_SOURCE,
  coverSource: COVER_SOURCE,
});

/**
 * Use at server startup. Target IDs identify a server/cluster and database together.
 * The trusted openers verify their live connections and roles before reporting IDs.
 * Each opener owns cleanup until it returns a handle. The caller owns shutdown after
 * activation and should stop accepting work before closing the assembled providers.
 */
export async function assemblePublicationProviders(options?: Options) {
  if (!options) return inactive;
  const { approvedTarget, openAdmin, openPublic } = options;
  if (typeof approvedTarget !== "string" || !approvedTarget || approvedTarget !== approvedTarget.trim() ||
      typeof openAdmin !== "function" || typeof openPublic !== "function") return inactive;

  const releases: Close[] = [];
  let shutdown: Promise<void> | undefined;
  function close() {
    return shutdown ??= Promise.allSettled(releases.map(release => Promise.resolve().then(release))).then(results => {
      if (results.some(result => result.status === "rejected")) throw new Error("Publication provider shutdown failed");
    });
  }

  async function deactivate() {
    await close().catch(() => undefined);
    return inactive;
  }

  try {
    const admin = await openAdmin();
    if (typeof admin?.close !== "function") return inactive;
    releases.push(admin.close.bind(admin));
    if (admin.verifiedTarget !== approvedTarget || typeof admin.store?.transaction !== "function") return deactivate();

    const readers = await openPublic();
    if (typeof readers?.close !== "function") return deactivate();
    releases.push(readers.close.bind(readers));
    if (readers.verifiedListTarget !== approvedTarget || readers.verifiedCoverTarget !== approvedTarget) return deactivate();

    const publicSources = await createPublicationShowcaseConnection(async () => readers);
    if (publicSources.showcaseSource.mode !== "active" || publicSources.coverSource.mode !== "active") return deactivate();
    return Object.freeze({
      mode: "active" as const,
      adminStore: Object.freeze({ transaction: admin.store.transaction.bind(admin.store) }),
      ...publicSources,
      close,
    });
  } catch {
    // A partially initialized assembly is never exposed.
    return deactivate();
  }
}
