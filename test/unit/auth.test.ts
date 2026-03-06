import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAuthHeaders } from "../../src/auth.js";
import type { AffineConfig } from "../../src/config.js";

function makeConfig(overrides: Partial<AffineConfig> = {}): AffineConfig {
  return { baseUrl: "http://localhost:3010", ...overrides };
}

describe("getAuthHeaders", () => {
  it("returns Authorization header when token is set", () => {
    const config = makeConfig({ token: "my-token" });
    const headers = getAuthHeaders(config);
    assert.equal(headers["Authorization"], "Bearer my-token");
    assert.equal(headers["Cookie"], undefined);
  });

  it("returns Cookie header when cookie is passed", () => {
    const config = makeConfig();
    const headers = getAuthHeaders(config, "session=abc");
    assert.equal(headers["Cookie"], "session=abc");
    assert.equal(headers["Authorization"], undefined);
  });

  it("returns Cookie header from config when no session cookie", () => {
    const config = makeConfig({ cookie: "session=from-config" });
    const headers = getAuthHeaders(config);
    assert.equal(headers["Cookie"], "session=from-config");
  });

  it("prefers token over cookie", () => {
    const config = makeConfig({ token: "my-token", cookie: "session=abc" });
    const headers = getAuthHeaders(config);
    assert.equal(headers["Authorization"], "Bearer my-token");
    assert.equal(headers["Cookie"], undefined);
  });

  it("prefers session cookie over config cookie", () => {
    const config = makeConfig({ cookie: "session=from-config" });
    const headers = getAuthHeaders(config, "session=from-signin");
    assert.equal(headers["Cookie"], "session=from-signin");
  });

  it("returns empty headers when no auth is configured", () => {
    const config = makeConfig();
    const headers = getAuthHeaders(config);
    assert.deepEqual(headers, {});
  });
});
