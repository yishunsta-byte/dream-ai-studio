import "server-only";

import { COVER_SOURCE } from "./cover-source";
import { assemblePublicationProviders } from "./publication-provider-assembly";
import { loadPublicationRuntimeOptions, type PublicationRuntimeOptions } from "./publication-runtime-config";
import { SHOWCASE_SOURCE } from "./showcase-source";

const inactive = Object.freeze({ mode: "inactive" as const, adminStore: null, showcaseSource: SHOWCASE_SOURCE, coverSource: COVER_SOURCE });
type Assembly = Awaited<ReturnType<typeof assemblePublicationProviders>>;

export function createPublicationRuntime(loadOptions: () => PublicationRuntimeOptions | Promise<PublicationRuntimeOptions>) {
  let initialization: Promise<Assembly> | undefined;
  let shutdown: Promise<void> | undefined;
  let stopping = false;

  async function get() {
    if (stopping) return inactive;
    initialization ??= Promise.resolve().then(async () => {
      if (stopping) return inactive;
      const options = await loadOptions();
      return stopping ? inactive : assemblePublicationProviders(options);
    }).catch(() => inactive);
    const providers = await initialization;
    return stopping ? inactive : providers;
  }

  function close() {
    stopping = true;
    return shutdown ??= Promise.resolve(initialization).then(async providers => {
      if (providers?.mode === "active") await providers.close();
    });
  }

  return Object.freeze({ get, close });
}

// Next may bundle the render and API entry points separately in the same Node process.
const runtimeKey = Symbol.for("dream-ai-studio.publication-runtime");
const processScope = globalThis as typeof globalThis & { [runtimeKey]?: ReturnType<typeof createPublicationRuntime> };
function runtime() {
  return processScope[runtimeKey] ??= createPublicationRuntime(loadPublicationRuntimeOptions);
}

export async function getPublicationAdminStore() {
  return (await runtime().get()).adminStore;
}

export async function getPublicationPublicReaders() {
  const { showcaseSource, coverSource } = await runtime().get();
  return { showcaseSource, coverSource };
}

/** Call from the Node host's lifecycle after draining requests admitted before shutdown. */
export function closePublicationRuntime() {
  return runtime().close();
}
