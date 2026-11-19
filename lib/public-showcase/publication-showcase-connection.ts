import "server-only";

import type { CoverSource } from "./cover-source";
import type { ShowcaseSource } from "./showcase-source";

type PublicReaders = Readonly<{ showcaseSource: ShowcaseSource; coverSource: CoverSource }>;
const inactive: PublicReaders = Object.freeze({
  showcaseSource: Object.freeze({ mode: "sample" }),
  coverSource: Object.freeze({ mode: "inactive" }),
});

/** The server initializer must verify both read roles against the same publication authority. */
export async function createPublicationShowcaseConnection(openVerifiedReaders?: () => Promise<PublicReaders>): Promise<PublicReaders> {
  if (!openVerifiedReaders) return inactive;
  try {
    const { showcaseSource, coverSource } = await openVerifiedReaders();
    if (showcaseSource.mode !== "active" || coverSource.mode !== "active") return inactive;
    const listStore = showcaseSource.store;
    const coverStore = coverSource.store;
    if (!listStore || !coverStore) return inactive;

    const { listApproved } = listStore;
    const { findCover, readObject, confirmCover } = coverStore;
    if (typeof listApproved !== "function" || typeof findCover !== "function" ||
        typeof readObject !== "function" || typeof confirmCover !== "function") return inactive;

    return Object.freeze({
      showcaseSource: Object.freeze({ mode: "active", store: Object.freeze({ listApproved: listApproved.bind(listStore) }) }),
      coverSource: Object.freeze({ mode: "active", store: Object.freeze({
        findCover: findCover.bind(coverStore), readObject: readObject.bind(coverStore), confirmCover: confirmCover.bind(coverStore),
      }) }),
    });
  } catch {
    return inactive;
  }
}
