import { describe, expect, it } from "vitest";

import { refusal } from "./guard";

const headers = (values: Record<string, string>): Headers =>
  new Headers(values);

const post = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  "content-type": "application/json",
};

describe("refusal", () => {
  it("allows local reads", () => {
    for (const host of ["127.0.0.1:3000", "localhost:4000", "[::1]:3000"])
      expect(refusal(headers({ host }), { mutating: false })).toBeUndefined();
  });

  it("refuses a foreign Host, as a DNS-rebinding page would send", () => {
    expect(
      refusal(headers({ host: "evil.example:3000" }), { mutating: false })
    ).toMatch(/localhost/);
    expect(refusal(headers({}), { mutating: false })).toBeDefined();
  });

  it("allows a same-origin JSON post", () => {
    expect(refusal(headers(post), { mutating: true })).toBeUndefined();
    expect(
      refusal(
        headers({ ...post, "content-type": "application/json; charset=utf-8" }),
        {
          mutating: true,
        }
      )
    ).toBeUndefined();
  });

  it("refuses posts from another origin or without one", () => {
    expect(
      refusal(headers({ ...post, origin: "http://evil.example" }), {
        mutating: true,
      })
    ).toMatch(/cross-origin/);
    expect(
      refusal(headers({ ...post, origin: "http://127.0.0.1:9999" }), {
        mutating: true,
      })
    ).toMatch(/cross-origin/);
    const { origin: _origin, ...noOrigin } = post;
    expect(refusal(headers(noOrigin), { mutating: true })).toMatch(
      /cross-origin/
    );
    expect(
      refusal(headers({ ...post, origin: "null" }), { mutating: true })
    ).toMatch(/cross-origin/);
  });

  it("refuses non-JSON posts, as a cross-site form would send", () => {
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ])
      expect(
        refusal(headers({ ...post, "content-type": type }), { mutating: true })
      ).toMatch(/json/);
  });
});
