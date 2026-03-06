import type { AffineConfig } from "./config.js";

export async function signIn(
  config: AffineConfig
): Promise<string | undefined> {
  if (config.token || config.cookie) return undefined;
  if (!config.email || !config.password) return undefined;

  const res = await fetch(`${config.baseUrl}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
    redirect: "manual",
  });

  if (!res.ok && res.status !== 302) {
    throw new Error(`Sign-in failed: ${res.status} ${res.statusText}`);
  }

  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) {
    throw new Error("Sign-in succeeded but no cookies returned");
  }

  return setCookies
    .map((c) => c.split(";")[0])
    .join("; ");
}

export function getAuthHeaders(config: AffineConfig, cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  } else if (cookie || config.cookie) {
    headers["Cookie"] = (cookie || config.cookie)!;
  }
  return headers;
}
