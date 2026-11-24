import { extname } from "node:path";
import { inspectRenderedPublicationMedia } from "../lib/public-showcase/rendered-media-evidence";
import { isPlaybackExtension } from "../lib/public-showcase/playback-path";

const [, , path] = process.argv;
const ext = path && extname(path).slice(1).toLowerCase();
if (process.argv.length !== 3 || !isPlaybackExtension(ext)) {
  throw new Error("Supply one rendered .mp4, .webm, .mp3 or .m4a file");
}
const evidence = await inspectRenderedPublicationMedia(path, ext);
console.log(JSON.stringify(evidence));
