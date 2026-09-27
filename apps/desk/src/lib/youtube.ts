// YouTube URL parsing, kept in step with `parseYoutubeVideoId` in
// apps/cli/src/cli.ts (apps do not import each other).

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

const videoIdPattern = /^[\w-]{11}$/;

/** The 11-character video id in a YouTube URL. Throws if there is none. */
export function parseYoutubeVideoId(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`not a URL: ${input}`);
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !youtubeHosts.has(url.hostname)
  )
    throw new Error(`not a YouTube URL: ${input}`);

  const [first, second] = url.pathname.split("/").filter(Boolean);
  const id =
    url.hostname === "youtu.be"
      ? first
      : first === "watch"
        ? url.searchParams.get("v")
        : first === "live" || first === "shorts"
          ? second
          : undefined;
  if (!id || !videoIdPattern.test(id))
    throw new Error(`no YouTube video ID in: ${input}`);
  return id;
}

/** The canonical watch URL for a video id. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
