import { describe, expect, it } from "vitest";

import {
  alpacaCredentials,
  formatSegment,
  formatTick,
  jevConfig,
  parseJevArgs,
  parsePricesArgs,
  parseTranscribeArgs,
  parseYoutubeVideoId,
  run,
  typesafeApiKey,
  usage,
} from "./cli";

describe("run", () => {
  it("prints a greeting for --hello-world", () => {
    expect(run(["--hello-world"])).toBe("Hello, world!");
  });

  it("greets the given --name", () => {
    expect(run(["--hello-world", "--name=test"])).toBe("Hello, test!");
    expect(run(["--hello-world", "--name", "test"])).toBe("Hello, test!");
  });

  it("prints usage with no arguments", () => {
    expect(run([])).toBe(usage);
  });

  it("prints usage for --help and -h", () => {
    expect(run(["--help"])).toBe(usage);
    expect(run(["-h"])).toBe(usage);
  });

  it("throws on an unknown flag", () => {
    expect(() => run(["--nope"])).toThrow();
  });
});

describe("parseYoutubeVideoId", () => {
  it("reads watch, live, shorts and youtu.be URLs", () => {
    expect(
      parseYoutubeVideoId("https://www.youtube.com/watch?v=U5Ovbz8KnYE")
    ).toBe("U5Ovbz8KnYE");
    expect(parseYoutubeVideoId("https://youtube.com/live/U5Ovbz8KnYE")).toBe(
      "U5Ovbz8KnYE"
    );
    expect(
      parseYoutubeVideoId("https://m.youtube.com/shorts/U5Ovbz8KnYE?si=x")
    ).toBe("U5Ovbz8KnYE");
    expect(parseYoutubeVideoId("https://youtu.be/U5Ovbz8KnYE")).toBe(
      "U5Ovbz8KnYE"
    );
  });

  it("rejects other hosts, schemes and malformed IDs", () => {
    expect(() =>
      parseYoutubeVideoId("https://example.com/watch?v=U5Ovbz8KnYE")
    ).toThrow(/not a YouTube URL/);
    expect(() =>
      parseYoutubeVideoId("file://youtube.com/watch?v=U5Ovbz8KnYE")
    ).toThrow(/not a YouTube URL/);
    expect(() =>
      parseYoutubeVideoId("https://www.youtube.com/watch?v=../../etc")
    ).toThrow(/no YouTube video ID/);
    expect(() => parseYoutubeVideoId("--exec=rm")).toThrow(/not a URL/);
  });
});

describe("parseTranscribeArgs", () => {
  const url = "https://www.youtube.com/watch?v=U5Ovbz8KnYE";

  it("parses the URL and defaults", () => {
    expect(parseTranscribeArgs([url])).toEqual({
      url,
      videoId: "U5Ovbz8KnYE",
      model: undefined,
      language: undefined,
      chunkSeconds: undefined,
      realtime: false,
      json: false,
      out: undefined,
    });
  });

  it("parses options", () => {
    expect(
      parseTranscribeArgs([
        url,
        "--model=medium",
        "--language",
        "en",
        "--chunk=5",
        "--realtime",
        "--json",
        "--out=t.jsonl",
      ])
    ).toMatchObject({
      model: "medium",
      language: "en",
      chunkSeconds: 5,
      realtime: true,
      json: true,
      out: "t.jsonl",
    });
  });

  it("rejects missing or extra URLs, bad chunks and unknown flags", () => {
    expect(() => parseTranscribeArgs([])).toThrow(/needs a YouTube URL/);
    expect(() => parseTranscribeArgs([url, url])).toThrow(/unexpected/);
    expect(() => parseTranscribeArgs([url, "--chunk=2"])).toThrow(/--chunk/);
    expect(() => parseTranscribeArgs([url, "--chunk=abc"])).toThrow(/--chunk/);
    expect(() => parseTranscribeArgs([url, "--nope"])).toThrow();
  });
});

describe("formatSegment", () => {
  it("prefixes the text with an hh:mm:ss start time", () => {
    expect(formatSegment({ start: 3725.9, end: 3727, text: "hi" })).toBe(
      "[01:02:05] hi"
    );
  });
});

describe("parsePricesArgs", () => {
  it("defaults to formatted output", () => {
    expect(parsePricesArgs([])).toEqual({ json: false });
    expect(parsePricesArgs(["--json"])).toEqual({ json: true });
  });

  it("throws on unknown flags and arguments", () => {
    expect(() => parsePricesArgs(["--nope"])).toThrow();
    expect(() => parsePricesArgs(["GLD"])).toThrow();
  });
});

describe("alpacaCredentials", () => {
  it("reads both keys", () => {
    expect(
      alpacaCredentials({ ALPACA_API_KEY_ID: "k", ALPACA_API_SECRET_KEY: "s" })
    ).toEqual({ keyId: "k", secretKey: "s" });
  });

  it("names the missing keys", () => {
    expect(() => alpacaCredentials({})).toThrow(
      /missing ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY/
    );
    expect(() =>
      alpacaCredentials({ ALPACA_API_KEY_ID: "k", ALPACA_API_SECRET_KEY: "" })
    ).toThrow(/missing ALPACA_API_SECRET_KEY:/);
  });
});

describe("formatTick", () => {
  it("prints the UTC time, name, symbol, price and kind", () => {
    expect(
      formatTick({
        instrument: "gold",
        name: "Gold",
        symbol: "GLD",
        source: "trade",
        price: 243.1,
        size: 100,
        timestamp: "2026-09-25T14:31:07.123456789Z",
      })
    ).toBe("14:31:07  Gold      GLD           243.10  trade");
    expect(
      formatTick({
        instrument: "bitcoin",
        name: "Bitcoin",
        symbol: "BTC/USD",
        source: "quote",
        price: 64000.25,
        bid: 64000,
        ask: 64000.5,
        timestamp: "2026-09-25T14:31:08Z",
      })
    ).toBe("14:31:08  Bitcoin   BTC/USD     64000.25  mid");
  });
});

describe("parseJevArgs", () => {
  const url = "https://www.youtube.com/watch?v=U5Ovbz8KnYE";

  it("applies defaults for a live stream", () => {
    expect(parseJevArgs([url])).toEqual({
      source: { kind: "live", url, videoId: "U5Ovbz8KnYE" },
      id: "U5Ovbz8KnYE",
      decider: { kind: "typesafe" },
      model: undefined,
      whisper: undefined,
      language: undefined,
      chunkSeconds: undefined,
      cash: 100_000,
      size: 0.1,
      minChars: 400,
      intervalSeconds: 30,
      contextSeconds: 300,
      minConfidence: 0.6,
      minSignal: 0.5,
      maxLeverage: 1,
      maxPriceAgeSeconds: 600,
      snapshotSeconds: 60,
      state: undefined,
      reset: false,
      out: undefined,
      json: false,
    });
  });

  it("reads every option", () => {
    expect(
      parseJevArgs([
        "--replay=rec/abc.jsonl",
        "--prices=ticks.jsonl",
        "--fast",
        "--decider=script:plan.jsonl",
        "--model=jev-preview",
        "--cash=5000",
        "--size=0.25",
        "--min-chars=100",
        "--interval=60",
        "--context=120",
        "--min-confidence=0.8",
        "--min-signal=0.7",
        "--max-leverage=2",
        "--max-price-age=30",
        "--snapshot=0",
        "--state=book.json",
        "--reset",
        "--out=ledger.jsonl",
        "--json",
      ])
    ).toMatchObject({
      source: {
        kind: "replay",
        transcript: "rec/abc.jsonl",
        prices: "ticks.jsonl",
        fast: true,
      },
      id: "abc",
      decider: { kind: "script", path: "plan.jsonl" },
      model: "jev-preview",
      cash: 5000,
      size: 0.25,
      minChars: 100,
      intervalSeconds: 60,
      contextSeconds: 120,
      minConfidence: 0.8,
      minSignal: 0.7,
      maxLeverage: 2,
      maxPriceAgeSeconds: 30,
      snapshotSeconds: 0,
      state: "book.json",
      reset: true,
      out: "ledger.jsonl",
      json: true,
    });
    expect(
      parseJevArgs([
        url,
        "--decider=hold",
        "--whisper=medium",
        "--language=en",
        "--chunk=5",
      ])
    ).toMatchObject({
      decider: { kind: "hold" },
      whisper: "medium",
      language: "en",
      chunkSeconds: 5,
    });
  });

  it("rejects contradictory sources and options that do not apply", () => {
    expect(() => parseJevArgs([])).toThrow(/needs a YouTube URL or --replay/);
    expect(() => parseJevArgs([url, "--replay=a.jsonl"])).toThrow(/not both/);
    expect(() => parseJevArgs([url, "--prices=t.jsonl"])).toThrow(
      /only apply to --replay/
    );
    expect(() => parseJevArgs([url, "--fast"])).toThrow(
      /only apply to --replay/
    );
    expect(() => parseJevArgs(["--replay=a.jsonl", "--fast"])).toThrow(
      /--fast needs --prices/
    );
    expect(() => parseJevArgs(["--replay=a.jsonl", "--language=en"])).toThrow(
      /only apply to a live stream/
    );
    expect(() => parseJevArgs([url, "extra"])).toThrow(/unexpected arguments/);
    expect(() => parseJevArgs([url, "--nope"])).toThrow();
  });

  it("validates numbers and the decider", () => {
    expect(() => parseJevArgs([url, "--size=0"])).toThrow(
      /--size must be a number above 0 and at most 1, got 0/
    );
    expect(() => parseJevArgs([url, "--size=1.5"])).toThrow(/--size/);
    expect(() => parseJevArgs([url, "--cash=abc"])).toThrow(
      /--cash must be a number above 0/
    );
    expect(() => parseJevArgs([url, "--interval=4"])).toThrow(
      /--interval must be a number at least 5/
    );
    expect(() => parseJevArgs([url, "--context=-1"])).toThrow(
      /--context must be a number at least 0/
    );
    expect(() => parseJevArgs([url, "--min-chars=0"])).toThrow(/--min-chars/);
    expect(() => parseJevArgs([url, "--min-chars=5000"])).toThrow(
      /--min-chars must be an integer at least 1 and at most 4000/
    );
    expect(() => parseJevArgs([url, "--min-signal=2"])).toThrow(/--min-signal/);
    expect(() => parseJevArgs([url, "--min-confidence=2"])).toThrow(
      /--min-confidence must be a number at least 0 and at most 1/
    );
    expect(() => parseJevArgs([url, "--snapshot=-1"])).toThrow(
      /--snapshot must be a number at least 0/
    );
    expect(() => parseJevArgs([url, "--decider=magic"])).toThrow(
      /--decider must be typesafe, hold or script:<path>/
    );
    expect(() => parseJevArgs([url, "--decider=script:"])).toThrow(/--decider/);
    expect(() => parseJevArgs([url, "--chunk=2"])).toThrow(
      /--chunk must be a number of seconds above 2/
    );
    expect(() => parseJevArgs([url, "--model="])).toThrow(
      /--model needs a value/
    );
    expect(() => parseJevArgs([url, "--state="])).toThrow(
      /--state needs a value/
    );
    expect(() => parseJevArgs(["--replay="])).toThrow(/--replay needs a value/);
  });
});

describe("typesafeApiKey", () => {
  it("names the missing key", () => {
    expect(typesafeApiKey({ TYPESAFE_API_KEY: "ts-test" })).toBe("ts-test");
    expect(() => typesafeApiKey({})).toThrow(
      /missing TYPESAFE_API_KEY: set it in the environment or in \.env/
    );
  });
});

describe("jevConfig", () => {
  const env = {
    ALPACA_API_KEY_ID: "id",
    ALPACA_API_SECRET_KEY: "secret",
    TYPESAFE_API_KEY: "ts-test",
    JEV_MODEL: "jev-preview",
  };
  const live = parseJevArgs(["https://youtu.be/U5Ovbz8KnYE"]);

  it("collects only what the run needs", () => {
    expect(jevConfig(live, env)).toEqual({
      alpaca: { keyId: "id", secretKey: "secret" },
      typesafeApiKey: "ts-test",
      model: "jev-preview",
    });
    expect(
      jevConfig(
        parseJevArgs([
          "--replay=a.jsonl",
          "--prices=t.jsonl",
          "--decider=hold",
        ]),
        {}
      )
    ).toEqual({
      model: "jev-latest",
    });
    expect(jevConfig({ ...live, model: "jev-1.13.0" }, env).model).toBe(
      "jev-1.13.0"
    );
    expect(jevConfig(live, { ...env, JEV_MODEL: "  " }).model).toBe(
      "jev-latest"
    );
  });

  it("throws naming the missing secret", () => {
    expect(() => jevConfig(live, { TYPESAFE_API_KEY: "x" })).toThrow(
      /ALPACA_API_KEY_ID/
    );
    expect(() =>
      jevConfig(live, { ALPACA_API_KEY_ID: "a", ALPACA_API_SECRET_KEY: "b" })
    ).toThrow(/TYPESAFE_API_KEY/);
  });
});
