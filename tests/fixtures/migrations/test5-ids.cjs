/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- code migration step: restricted .cjs format run by lib/db/code-migration.ts */
// Test-only code migration helper (T-048/T-051): a stable UUID-shaped id from a source key. Listed in the step's files.
const { createHash } = require("node:crypto");
function derivedId(source) {
  const hex = createHash("sha256").update(`test5:${source}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
module.exports = { derivedId };
