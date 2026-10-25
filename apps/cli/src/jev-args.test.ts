import { describe, expect, it } from "vitest";

import { jevConfig, parseJevArgs, typesafeApiKey } from "./jev-args";

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
      sizing: "fixed",
      risk: 0.002,
      maxChaseZ: 3,
      stopZ: 0,
      takeProfitZ: 0,
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
        "--audio-start=2026-09-16T18:30:00Z",
        "--lag=20",
        "--tee",
        "--decider=script:plan.jsonl",
        "--model=jev-preview",
        "--cash=5000",
        "--size=0.25",
        "--sizing=vol",
        "--risk=0.005",
        "--max-chase-z=0",
        "--stop-z=3",
        "--take-profit-z=5",
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
        audioStart: "2026-09-16T18:30:00.000Z",
        lagSeconds: 20,
        tee: true,
      },
      id: "abc",
      decider: { kind: "script", path: "plan.jsonl" },
      model: "jev-preview",
      cash: 5000,
      size: 0.25,
      sizing: "vol",
      risk: 0.005,
      maxChaseZ: 0,
      stopZ: 3,
      takeProfitZ: 5,
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
    expect(() => parseJevArgs([url, "--lag=5"])).toThrow(
      /only apply to --replay/
    );
    expect(() => parseJevArgs([url, "--tee"])).toThrow(
      /only apply to --replay/
    );
    expect(() =>
      parseJevArgs(["--replay=a.jsonl", "--audio-start=noon"])
    ).toThrow(/--audio-start must be an RFC 3339 time with a zone/);
    expect(() => parseJevArgs(["--replay=a.jsonl", "--lag=-1"])).toThrow(
      /--lag must be a number at least 0/
    );
    expect(() => parseJevArgs(["--replay=a.jsonl", "--fast"])).toThrow(
      /--fast needs --prices/
    );
    expect(() => parseJevArgs(["--replay=a.jsonl", "--language=en"])).toThrow(
      /only apply to a live stream/
    );
    expect(() => parseJevArgs([url, "extra"])).toThrow(/unexpected arguments/);
    expect(() => parseJevArgs([url, "--sizing=kelly"])).toThrow(
      /--sizing must be fixed or vol/
    );
    expect(() => parseJevArgs([url, "--risk=0.01"])).toThrow(
      /--risk only applies to --sizing=vol/
    );
    expect(() => parseJevArgs([url, "--stop-z=-1"])).toThrow(/--stop-z/);
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
