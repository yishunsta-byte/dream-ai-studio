import "server-only";

import { actorFromVerifiedUserId } from "../db/postgres/types";
import { createPublicationCoverStorageReaders } from "./publication-cover-storage";
import { createPublicationMediaRangeReader } from "./publication-media-storage";
import type { PublicationRuntimeOptions } from "./publication-runtime-config";
import { createVerifiedPublicationRuntimeOptions } from "./publication-verified-adapters";

type AdapterOptions = NonNullable<Parameters<typeof createVerifiedPublicationRuntimeOptions>[0]>;
type CoverStorageOptions = Parameters<typeof createPublicationCoverStorageReaders>[0];
type Options = Pick<AdapterOptions, "database" | "rightsReader" | "adminActorId"> & Readonly<{
  playbackStorage?: Parameters<typeof createPublicationMediaRangeReader>[0];
  storage: Omit<CoverStorageOptions, "adminActorId">;
}>;

/** Explicit server composition. The caller supplies approval and owns the runtime lifecycle. */
export function createPublicationServerConfig(options?: Options): PublicationRuntimeOptions {
  if (!options?.database || !options.rightsReader || !options.storage) return;
  const { database, rightsReader, storage } = options;
  try {
    const { id: adminActorId } = actorFromVerifiedUserId(options.adminActorId);
    const readers = createPublicationCoverStorageReaders({ ...storage, adminActorId });
    const readPublicMediaRange = options.playbackStorage && createPublicationMediaRangeReader(options.playbackStorage);
    return createVerifiedPublicationRuntimeOptions({ database, rightsReader, adminActorId, ...readers, readPublicMediaRange });
  } catch {
    return undefined;
  }
}
