import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PostgresMigrationError } from "./migration-manifest";

// Local source publication only. No catalog, target approval, runner or runtime.
export type PostgresSchemaVersionV3 = 5;
export function requirePostgresSchemaVersionV3(value: unknown): PostgresSchemaVersionV3 {
  if (value !== 5) throw new PostgresMigrationError("MIGRATION_SOURCE");
  return value;
}
const suffixChecksum = "d60cb359d759c17289fc7230cd43b8ec21dda61db61f3d041e01824f0f0b5aa1";
const entries = Object.freeze([
  Object.freeze({ ordinal: 1, id: "0001_schema", file: "0001_schema.sql",
    checksum: "3f88da7a33d9b63aafda5e12dbcad2a39de301ff4948c31d72582462a1b69b19",
    bodyChecksum: "2f12e9c5425a11c82263c883050d8404fccc04a8949f1c980e67352fcab3247e",
    sourceCharacters: 23465, bodyStart: 244, bodyEnd: 23456,
    prefixChecksum: "310731ea59f7f7ab150fc9f3a6785327b1bfa384f48c7f2811eedde4ab5613b0", suffixChecksum }),
  Object.freeze({ ordinal: 2, id: "0002_invariants", file: "0002_invariants.sql",
    checksum: "1b60efc9e79a0deeaea8e56bc84a05f647d2a7797de64d4f6defdb29a6cfa100",
    bodyChecksum: "c4b6758633dc7e94ccf8e936cdfb0686368af41a3d491c08b2daa8dd11fc9c0a",
    sourceCharacters: 10636, bodyStart: 181, bodyEnd: 10627,
    prefixChecksum: "38a26621ec97883dfd657f517ff8bd229f6fb1b2f50f88424050db9bb73ab89c", suffixChecksum }),
  Object.freeze({ ordinal: 3, id: "0003_rls", file: "0003_rls.sql",
    checksum: "7aa9567df35360112e6fa71554767e9980f0d7726f04600923cc41926cd9044d",
    bodyChecksum: "3a61af71d7db76e6937e5d542ecd26d056c9c4820f28b169fa2d61cc8ad58505",
    sourceCharacters: 2406, bodyStart: 244, bodyEnd: 2397,
    prefixChecksum: "a1b4ff2e02295b3c928d411b7847366f293baca0f29d180e1300ed8940040a00", suffixChecksum }),
  Object.freeze({ ordinal: 4, id: "0004_storage_verification", file: "0004_storage_verification.sql",
    checksum: "61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c",
    bodyChecksum: "21466ec97209bc8e6aaffcbba5657370762536f9c2cf220a7c137a0022acff8c",
    sourceCharacters: 55710, bodyStart: 248, bodyEnd: 55701,
    prefixChecksum: "738935c977151554853343121d5992202347335899c7f1ea00618c97288bc7ef", suffixChecksum }),
  Object.freeze({ ordinal: 5, id: "0005_upload_reservation", file: "0005_upload_reservation.sql",
    checksum: "f37dc54d88154bd32d57b987415481fdef2c599e41368059036861401a0e5339",
    bodyChecksum: "15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9",
    sourceCharacters: 38498, bodyStart: 237, bodyEnd: 38489,
    prefixChecksum: "b72476f166adaa1375571dffd614c2f3a7a73a692b42087e0cdc01595ef44905", suffixChecksum }),
] as const);
export const postgresMigrationManifestsV3 = Object.freeze({ 5: entries });
export const postgresSchema5SourcePublicationV3 = Object.freeze({
  draft: Object.freeze({ file: "drafts/0005_upload_reservation.sql",
    checksum: "9d347523a99a808240d03498dad24401c2c22d9c92e2479b1f9313eebd418ccb",
    bodyChecksum: "d08c609c0a9dfa069c71e19a6cffae5b4eb490c855d7f819cb97518c7baac368" }),
  experimental: Object.freeze({ checksum: "16e5a151858093818ece347d2a09a1590f4a1d5539a7c3107376c5d507a51c4e",
    bodyChecksum: "15a2bb3c2081a72fb1a9c3e4d50e241eb9d16d409db74566782e6ebdf4d7dfc9", fuseOffset: 252, fuseCharacters: 87 }),
  published: entries[4],
});
type Entry = typeof entries[number];
export type VerifiedPostgresMigrationSourceV3 = Readonly<Entry & { sql: string }>;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value) && value !== "0".repeat(64);

/** Only explicit schema5 and internal fixed paths. No caller root/manifest/hooks. */
export async function loadPostgresMigrationsV3(version: unknown): Promise<readonly VerifiedPostgresMigrationSourceV3[]> {
  if (arguments.length !== 1) throw new PostgresMigrationError("MIGRATION_SOURCE");
  requirePostgresSchemaVersionV3(version);
  try {
    // Primitive, detached immutable metadata/locations are fixed before any await.
    const snapshot = Object.freeze(entries.map(entry => Object.freeze({ ...entry,
      location: new URL(entry.file, import.meta.url).href })));
    if (snapshot.length !== 5 || new Set(snapshot.map(e => e.id)).size !== 5 || new Set(snapshot.map(e => e.file)).size !== 5 ||
      snapshot[4].bodyChecksum !== postgresSchema5SourcePublicationV3.experimental.bodyChecksum ||
      snapshot.some((e, i) => e.ordinal !== i + 1 || e.id.slice(0, 4) !== String(i + 1).padStart(4, "0") || e.id + ".sql" !== e.file ||
        ![e.checksum, e.bodyChecksum, e.prefixChecksum, e.suffixChecksum].every(digest))) throw new Error();
    return Object.freeze(await Promise.all(snapshot.map(async ({ location, ...entry }) => {
      const raw = await readFile(new URL(location), "utf8");
      if (typeof raw !== "string") throw new Error();
      const source = raw.replaceAll("\r\n", "\n");
      // Verify complete source first; fixed offsets are not a general SQL parser.
      if (source.length !== entry.sourceCharacters || sha(source) !== entry.checksum) throw new Error();
      const prefix = source.slice(0, entry.bodyStart), sql = source.slice(entry.bodyStart, entry.bodyEnd), suffix = source.slice(entry.bodyEnd);
      if (!prefix.endsWith("\nBEGIN;\n") || suffix !== "\nCOMMIT;\n" ||
        source.indexOf("\nBEGIN;\n") !== entry.bodyStart - 8 || source.lastIndexOf("\nCOMMIT;") !== entry.bodyEnd ||
        sha(prefix) !== entry.prefixChecksum || sha(sql) !== entry.bodyChecksum || sha(suffix) !== entry.suffixChecksum) throw new Error();
      return Object.freeze({ ...entry, sql });
    })));
  } catch { throw new PostgresMigrationError("MIGRATION_SOURCE"); }
}
