// YouTube URL parsing, kept in step with `parseYoutubeVideoId` in
// apps/cli/src/cli.ts (apps do not import each other).

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

const videoIdPattern = /^[\w-]{11}$/;

/** Where the id sits in a YouTube URL's path or query, by host and path. */
const candidateId = (url: URL): string | null | undefined => {
  const [first, second] = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "youtu.be") {
    return first;
  }
  if (first === "watch") {
    return url.searchParams.get("v");
  }
  if (first === "live" || first === "shorts") {
    return second;
  }
  return undefined;
};

/** The 11-character video id in a YouTube URL. Throws if there is none. */
const parseYoutubeVideoId = (input: string): string => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`not a URL: ${input}`);
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !youtubeHosts.has(url.hostname)
  ) {
    throw new Error(`not a YouTube URL: ${input}`);
  }

  const id = candidateId(url);
  if (id === null || id === undefined || !videoIdPattern.test(id)) {
    throw new Error(`no YouTube video ID in: ${input}`);
  }
  return id;
};

/** The canonical watch URL for a video id. */
const watchUrl = (videoId: string): string =>
  `https://www.youtube.com/watch?v=${videoId}`;

export { parseYoutubeVideoId, watchUrl };
