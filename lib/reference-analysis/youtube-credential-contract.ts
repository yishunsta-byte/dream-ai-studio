import { z } from "zod";
import { credentialKey } from "./analysis-credential-contract";

export const youtubeCredentialPath = "/api/admin/youtube-credentials";
export const youtubeCredentialVersion = z.number().int().min(1).max(2_147_483_647);
export const youtubeCredentialWrite = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  apiKey: credentialKey,
});
export const youtubeCredentialMetadata = z.discriminatedUnion("configured", [
  z.strictObject({ configured: z.literal(false), version: z.literal(0), updatedAt: z.null() }),
  z.strictObject({ configured: z.literal(true), version: youtubeCredentialVersion, updatedAt: z.iso.datetime() }),
]);
