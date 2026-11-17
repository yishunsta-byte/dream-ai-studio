import "server-only";

/** @internal Closed boundary port; never accepted by the public service API. */
type StatementPort = { query(text: string, values: readonly unknown[]): Promise<{ rows: unknown }> };
export function reservationEntries(port: StatementPort) {
  return Object.freeze({
    readSeed: (requestId: string, clientJson: string) => port.query("SELECT dream_reservation.read_upload_seed_v1($1::uuid,$2::text) AS reservation_reply", [requestId, clientJson]),
    reserve: (requestId: string, clientJson: string, raw: string) => port.query("SELECT dream_reservation.reserve_upload_v1($1::uuid,$2::text,$3::text) AS reservation_reply", [requestId, clientJson, raw]),
  });
}
