import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AFFINE_BASE_URL;
    delete process.env.AFFINE_EMAIL;
    delete process.env.AFFINE_PASSWORD;
    delete process.env.AFFINE_API_TOKEN;
    delete process.env.AFFINE_COOKIE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses default base URL when not set", () => {
    const config = loadConfig();
    assert.equal(config.baseUrl, "http://localhost:3010");
  });

  it("reads base URL from env", () => {
    process.env.AFFINE_BASE_URL = "https://affine.example.com";
    const config = loadConfig();
    assert.equal(config.baseUrl, "https://affine.example.com");
  });

  it("strips trailing slashes from base URL", () => {
    process.env.AFFINE_BASE_URL = "https://affine.example.com///";
    const config = loadConfig();
    assert.equal(config.baseUrl, "https://affine.example.com");
  });

  it("reads email and password from env", () => {
    process.env.AFFINE_EMAIL = "user@test.com";
    process.env.AFFINE_PASSWORD = "secret";
    const config = loadConfig();
    assert.equal(config.email, "user@test.com");
    assert.equal(config.password, "secret");
  });

  it("reads API token from env", () => {
    process.env.AFFINE_API_TOKEN = "my-token";
    const config = loadConfig();
    assert.equal(config.token, "my-token");
  });

  it("reads cookie from env", () => {
    process.env.AFFINE_COOKIE = "session=abc";
    const config = loadConfig();
    assert.equal(config.cookie, "session=abc");
  });

  it("returns undefined for unset optional fields", () => {
    const config = loadConfig();
    assert.equal(config.email, undefined);
    assert.equal(config.password, undefined);
    assert.equal(config.token, undefined);
    assert.equal(config.cookie, undefined);
  });
});
