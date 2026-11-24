import "server-only";

import { findActivePublicationCover, projectApprovedPublications } from "../../lib/public-showcase/admin-publication-service";
import type { CoverStore } from "../../lib/public-showcase/cover-source";
import type { PublicationRuntimeOptions } from "../../lib/public-showcase/publication-runtime-config";
import { ACTOR_A, syntheticCover, syntheticStore, verified, work } from "../admin/publication-http-fixture";

// Imported only by the isolated Next build. The parent process controls the startup
// barrier and explicit shutdown over IPC, outside the HTTP request surface.
export const t327Auth = async () => verified(ACTOR_A);

export async function loadT327Options(): Promise<PublicationRuntimeOptions> {
  if (!process.send) throw new Error("T327 requires the isolated IPC runner");
  const event = (name: string) => process.send?.(name);
  const ready = Promise.withResolvers<void>();
  process.on("message", (message) => {
    if (message === "release") ready.resolve();
    if (message === "close") {
      void import("../../lib/public-showcase/publication-runtime")
        .then(({ closePublicationRuntime }) => closePublicationRuntime())
        .then(() => event("closed"), () => event("close-error"));
    }
  });
  event("load");
  const mode = process.env.T327_FIXTURE;
  if (mode === "missing") return undefined;
  if (mode !== "verified" && mode !== "reader-error") throw new Error("Unknown T327 fixture mode");

  const target = "synthetic-cluster/publications";
  const poster = await syntheticCover();
  const fixture = syntheticStore(poster, [work(ACTOR_A, "neon-alley", 1)]);
  const findCover: CoverStore["findCover"] = async (address) =>
    findActivePublicationCover(fixture.snapshot().works[0], address, Date.now());

  return {
    approvedTarget: target,
    async openAdmin() {
      event("admin-open");
      await ready.promise;
      return { verifiedTarget: target, store: fixture.store, close: async () => { event("admin-close"); } };
    },
    async openPublic() {
      event("public-open");
      if (mode === "reader-error") throw new Error("Synthetic reader startup failure");
      return {
        verifiedListTarget: target,
        verifiedCoverTarget: target,
        close: async () => { event("public-close"); },
        showcaseSource: { mode: "active", store: {
          listApproved: async () => projectApprovedPublications(fixture.snapshot().works, Date.now()),
        } },
        coverSource: { mode: "active", store: {
          findCover,
          readObject: async () => poster.bytes,
          async confirmCover(address, expected, signal) {
            const current = await findCover(address, signal);
            return current?.objectKey === expected.objectKey && current.sha === expected.sha;
          },
        } },
      };
    },
  };
}
