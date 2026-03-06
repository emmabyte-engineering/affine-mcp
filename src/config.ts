export interface AffineConfig {
  baseUrl: string;
  email?: string;
  password?: string;
  token?: string;
  cookie?: string;
  serverVersion?: string;
}

export function loadConfig(): AffineConfig {
  const baseUrl = process.env.AFFINE_BASE_URL || "http://localhost:3010";
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    email: process.env.AFFINE_EMAIL,
    password: process.env.AFFINE_PASSWORD,
    token: process.env.AFFINE_API_TOKEN,
    cookie: process.env.AFFINE_COOKIE,
  };
}

export async function detectServerVersion(config: AffineConfig): Promise<string> {
  try {
    const res = await fetch(`${config.baseUrl}/info`);
    if (res.ok) {
      const info = (await res.json()) as { compatibleVersion?: string };
      if (info.compatibleVersion) return info.compatibleVersion;
    }
  } catch {
    // fall through
  }
  return "0.26.0"; // fallback
}
