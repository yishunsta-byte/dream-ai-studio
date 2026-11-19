import "server-only";

import type { assemblePublicationProviders } from "./publication-provider-assembly";

export type PublicationRuntimeOptions = Parameters<typeof assemblePublicationProviders>[0];

/** Composition point for an explicitly approved server deployment. */
export function loadPublicationRuntimeOptions(): PublicationRuntimeOptions | Promise<PublicationRuntimeOptions> {
  return undefined;
}
