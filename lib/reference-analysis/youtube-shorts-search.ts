import "server-only";

import { z } from "zod";
import { createYouTubeDataCaller, durationSeconds, publicCount, type YouTubeDataAccess } from "./youtube-data";
import { youtubeChannelIdSchema, youtubeShortsSearchLimit, youtubeVideoIdSchema,
  type YouTubeShortCandidate, type YouTubeShortsSearchRequest } from "./youtube-shorts-search-contract";

const searchItems = z.object({
  kind: z.literal("youtube#searchListResponse").optional(),
  items: z.array(z.object({ id: z.object({ videoId: youtubeVideoIdSchema.optional() }) })).max(youtubeShortsSearchLimit).optional(),
}).refine(value => value.kind !== undefined || value.items !== undefined);
const thumbnails = z.object({
  default: z.object({ url: z.string() }).optional(),
  medium: z.object({ url: z.string() }).optional(),
  high: z.object({ url: z.string() }).optional(),
});
const count = z.string().optional();
const videoItems = z.object({
  kind: z.literal("youtube#videoListResponse").optional(),
  items: z.array(z.object({
    id: youtubeVideoIdSchema,
    status: z.object({ privacyStatus: z.string() }),
    snippet: z.object({
      title: z.string().trim().min(1).max(300),
      channelId: youtubeChannelIdSchema,
      channelTitle: z.string().trim().min(1).max(200),
      publishedAt: z.iso.datetime({ offset: true }),
      thumbnails: thumbnails.optional(),
    }),
    contentDetails: z.object({ duration: z.string().optional() }).optional(),
    statistics: z.object({ viewCount: count, likeCount: count, commentCount: count }).optional(),
  })).max(youtubeShortsSearchLimit).optional(),
}).refine(value => value.kind !== undefined || value.items !== undefined);
const channelItems = z.object({
  kind: z.literal("youtube#channelListResponse").optional(),
  items: z.array(z.object({
    id: youtubeChannelIdSchema,
    statistics: z.object({ subscriberCount: count, hiddenSubscriberCount: z.boolean().optional() }).optional(),
  })).max(youtubeShortsSearchLimit).optional(),
}).refine(value => value.kind !== undefined || value.items !== undefined);

function thumbnailUrl(url: string | undefined): string | null {
  if (!url || url.length > 1024) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
        !/^(?:i\d{0,2}\.ytimg\.com|img\.youtube\.com)$/.test(parsed.hostname)) return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch { return null; }
}

export async function searchYouTubeShorts({ request, ...access }: YouTubeDataAccess & {
  request: YouTubeShortsSearchRequest;
}): Promise<YouTubeShortCandidate[]> {
  const call = createYouTubeDataCaller(access);
  const search = await call("search", {
    part: "snippet", fields: "kind,items(id(videoId))", type: "video", q: request.query,
    maxResults: String(youtubeShortsSearchLimit), order: request.order, videoDuration: "short",
    regionCode: "KR", relevanceLanguage: "ko",
    ...(request.dateFrom && { publishedAfter: request.dateFrom + "T00:00:00Z" }),
    ...(request.dateTo && { publishedBefore: request.dateTo + "T23:59:59.999Z" }),
  }, searchItems);
  const ids = [...new Set((search.items ?? []).flatMap(item => item.id.videoId ?? []))];
  if (!ids.length) return [];
  const details = await call("videos", {
    part: "snippet,statistics,contentDetails,status",
    fields: "kind,items(id,snippet(title,channelId,channelTitle,publishedAt,thumbnails),statistics(viewCount,likeCount,commentCount),contentDetails(duration),status(privacyStatus))",
    id: ids.join(","),
  }, videoItems);
  const videos = new Map((details.items ?? []).filter(item => item.status.privacyStatus === "public").map(item => [item.id, item]));
  const ordered = ids.flatMap(id => videos.get(id) ?? []);
  if (!ordered.length) return [];
  const channelIds = [...new Set(ordered.map(video => video.snippet.channelId))];
  const channels = await call("channels", {
    part: "statistics", fields: "kind,items(id,statistics(subscriberCount,hiddenSubscriberCount))", id: channelIds.join(","),
  }, channelItems);
  const stats = new Map((channels.items ?? []).map(item => [item.id, item.statistics]));
  return ordered.map(video => {
    const { id, snippet, contentDetails, statistics } = video;
    const channel = stats.get(snippet.channelId);
    const thumbnail = snippet.thumbnails;
    return {
      id, url: "https://www.youtube.com/watch?v=" + id, title: snippet.title,
      channelId: snippet.channelId, channelTitle: snippet.channelTitle, publishedAt: snippet.publishedAt,
      thumbnailUrl: thumbnailUrl(thumbnail?.medium?.url ?? thumbnail?.high?.url ?? thumbnail?.default?.url),
      durationSeconds: durationSeconds(contentDetails?.duration),
      views: publicCount(statistics?.viewCount), likes: publicCount(statistics?.likeCount), comments: publicCount(statistics?.commentCount),
      subscribers: channel?.hiddenSubscriberCount ? null : publicCount(channel?.subscriberCount),
    };
  });
}
