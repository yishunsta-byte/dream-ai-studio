import "server-only";
import { analyzeLocalReferenceAudio } from "./audio-features";
import { analyzeLocalReferenceImage } from "./image-features";
import { classifyReferenceInput } from "./input";
import { registeredReferenceSnapshotSchema, type ReferenceFileOptions } from "./local-file";
import { analyzeLocalReferenceVideo } from "./video-features";

type BoundAnalysis =
  | ({ media: "video" } & Awaited<ReturnType<typeof analyzeLocalReferenceVideo>>)
  | ({ media: "music" } & Awaited<ReturnType<typeof analyzeLocalReferenceAudio>>)
  | ({ media: "image" } & Awaited<ReturnType<typeof analyzeLocalReferenceImage>>);

type RegisteredSnapshotResult =
  | { status: "bound"; proof: { snapshotSha256: string; sourceGeneration: string }; analysis: BoundAnalysis }
  | { status: "unavailable"; reason: "unverified_analysis"; fileIssue: "invalid_file" | "file_type_mismatch" }
  | { status: "unavailable"; reason: "invalid_registration" | "unverified_analysis" | "cancelled" | "timed_out" };

/**
 * Internal analysis only. The server resolves the registered path, ownership, registered digest and active generation.
 * Use the existing result projections for response DTOs. The proof and analyzer-local data stay on the server.
 */
export async function analyzeRegisteredReferenceSnapshot(
  path: string, submission: unknown, authority: unknown, options: Omit<ReferenceFileOptions, "registration">,
): Promise<RegisteredSnapshotResult> {
  const registration = registeredReferenceSnapshotSchema.safeParse(authority);
  if (!registration.success) return { status: "unavailable", reason: "invalid_registration" };
  const input = classifyReferenceInput(submission);
  if (input.status !== "ready" || input.source.kind !== "file") {
    return { status: "unavailable", reason: "unverified_analysis" };
  }

  const { media } = input.source;
  const boundOptions = { ...options, registration: registration.data };
  const analysis: BoundAnalysis = media === "video" ? { media, ...await analyzeLocalReferenceVideo(path, submission, boundOptions) }
    : media === "music" ? { media, ...await analyzeLocalReferenceAudio(path, submission, boundOptions) }
      : { media, ...await analyzeLocalReferenceImage(path, submission, boundOptions) };
  const inspection = analysis.inspection.inspection;
  if (inspection === "cancelled" || inspection === "timed_out") return { status: "unavailable", reason: inspection };
  if (inspection === "invalid_file") {
    const inspected = analysis.inspection.input;
    return {
      status: "unavailable", reason: "unverified_analysis",
      fileIssue: inspected.status === "invalid" && inspected.reason === "file_type_mismatch" ? "file_type_mismatch" : "invalid_file",
    };
  }

  const features = analysis.media === "video" ? analysis.video : analysis.media === "music" ? analysis.audio : analysis.image;
  if (inspection !== "completed" || features.status !== "completed") {
    return { status: "unavailable", reason: "unverified_analysis" };
  }
  return {
    status: "bound", proof: { snapshotSha256: registration.data.sha256, sourceGeneration: registration.data.sourceGeneration }, analysis,
  };
}
