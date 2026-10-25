"use client";

// The run's YouTube video, through the IFrame API so the timeline can seek
// it. Loaded client-only (next/dynamic), since it needs `window`.
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SeekTarget } from "../lib/video";

type YTPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getDuration(): number;
  playVideo(): void;
  destroy(): void;
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
type YouTubeWindow = Window & {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
};

/** What the run page can do with the player. */
export type PlayerHandle = { seek: (target: SeekTarget) => void };

let loading: Promise<YTNamespace> | undefined;

/** Loads the IFrame API script once. */
function loadYouTube(): Promise<YTNamespace> {
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const page: YouTubeWindow = window;
    if (page.YT?.Player) {
      resolve(page.YT);
      return;
    }
    const previous = page.onYouTubeIframeAPIReady;
    page.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (page.YT) resolve(page.YT);
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
}

function handleFor(player: YTPlayer): PlayerHandle {
  return {
    seek: (target) => {
      const seconds =
        target.kind === "absolute"
          ? target.seconds
          : // On a live stream the duration is the live edge.
            player.getDuration() - (Date.now() - target.wallTime) / 1000;
      player.seekTo(Math.max(0, seconds), true);
      player.playVideo();
    },
  };
}

export default function VideoPlayer({
  videoId,
  autoplay = true,
  onReady,
}: {
  videoId: string;
  /** Off for replays, whose timeline does not follow the video's start. */
  autoplay?: boolean;
  onReady: (handle: PlayerHandle | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let player: YTPlayer | undefined;
    let cancelled = false;
    loadYouTube()
      .then((YT) => {
        if (cancelled) return;
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
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
      onReady(null);
      player?.destroy();
      element.replaceChildren();
    };
  }, [videoId, autoplay, onReady]);

  return (
    <div className="border-line relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
      <div ref={host} className="absolute inset-0 [&_iframe]:size-full" />
      {error && (
        <div className="text-muted absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <TriangleAlert className="text-warn size-6" aria-hidden />
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
}
