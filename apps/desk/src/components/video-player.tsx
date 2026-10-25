"use client";

// The run's YouTube video, through the IFrame API so the timeline can seek
// it. Loaded client-only (next/dynamic), since it needs `window`.
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SeekTarget } from "~/lib/video";

type YTPlayer = {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getDuration: () => number;
  playVideo: () => void;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host: string;
      width: string;
      height: string;
      playerVars: Record<string, number>;
      events: { onReady: () => void };
    }
  ) => YTPlayer;
};

/** The globals the IFrame API script sets and calls. */
type YouTubeGlobals = typeof globalThis & {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
};

/** What the run page can do with the player. */
type PlayerHandle = { seek: (target: SeekTarget) => void };

let loading: Promise<YTNamespace> | undefined;

/** Loads the IFrame API script once. */
const loadYouTube = (): Promise<YTNamespace> => {
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const page: YouTubeGlobals = globalThis;
    if (page.YT?.Player) {
      resolve(page.YT);
      return;
    }
    const previous = page.onYouTubeIframeAPIReady;
    page.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (page.YT) {
        resolve(page.YT);
      }
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      loading = undefined;
      reject(new Error("could not load the YouTube player"));
    };
    document.head.append(script);
  });
  return loading;
};

const handleFor = (player: YTPlayer): PlayerHandle => ({
  seek: (target) => {
    const seconds =
      target.kind === "absolute"
        ? target.seconds
        : // On a live stream the duration is the live edge.
          player.getDuration() - (Date.now() - target.wallTime) / 1000;
    player.seekTo(Math.max(0, seconds), true);
    player.playVideo();
  },
});

const VideoPlayer = ({
  videoId,
  autoplay = true,
  onReady,
}: {
  videoId: string;
  /** Off for replays, whose timeline does not follow the video's start. */
  autoplay?: boolean;
  onReady: (handle: PlayerHandle | null) => void;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) {
      return undefined;
    }
    let player: YTPlayer | undefined;
    let cancelled = false;
    loadYouTube()
      .then((YT) => {
        if (cancelled) {
          return;
        }
        // The API replaces this node with its iframe.
        const mount = document.createElement("div");
        element.append(mount);
        const created = new YT.Player(mount, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: autoplay ? 1 : 0,
            mute: 1,
            playsinline: 1,
            rel: 0,
          },
          events: { onReady: () => onReady(handleFor(created)) },
        });
        player = created;
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
      onReady(null);
      player?.destroy();
      element.replaceChildren();
    };
  }, [videoId, autoplay, onReady]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
      <div ref={host} className="absolute inset-0 [&_iframe]:size-full" />
      {error !== null && error !== "" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-muted">
          <TriangleAlert className="size-6 text-warn" aria-hidden />
          {error}
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noreferrer"
          >
            Open on YouTube
          </a>
        </div>
      )}
    </div>
  );
};

export { VideoPlayer };
export type { PlayerHandle };
