/**
 * E2E test setup: waits for AFFiNE to be healthy, then creates the admin user.
 * Used by CI before running integration tests.
 */
import "dotenv/config";

const AFFINE_URL = process.env.AFFINE_BASE_URL || "http://localhost:3010";
const TEST_EMAIL = requireEnv("AFFINE_EMAIL");
const TEST_PASSWORD = requireEnv("AFFINE_PASSWORD");
const MAX_WAIT_MS = 120_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}
const POLL_INTERVAL_MS = 3_000;

async function waitForAffine(): Promise<void> {
  const start = Date.now();
  console.log(`Waiting for AFFiNE at ${AFFINE_URL}...`);

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(`${AFFINE_URL}/info`);
      if (res.ok) {
        const info = await res.json();
        console.log(`AFFiNE is ready (version: ${(info as any).compatibleVersion || "unknown"})`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`AFFiNE did not become ready within ${MAX_WAIT_MS / 1000}s`);
}

async function createAdminUser(): Promise<void> {
  console.log(`Creating admin user: ${TEST_EMAIL}`);

  const res = await fetch(`${AFFINE_URL}/api/setup/create-admin-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test User",
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // If the first user was already created, that's fine
    if (body.includes("First user already created")) {
      console.log("Admin user already exists, continuing.");
      return;
    }
    throw new Error(`Failed to create admin user: ${res.status} ${body}`);
  }

  const user = await res.json();
  console.log(`Admin user created: ${(user as any).email} (${(user as any).id})`);
}

async function signIn(): Promise<string> {
  const res = await fetch(`${AFFINE_URL}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    redirect: "manual",
  });

  if (!res.ok && res.status !== 302) {
    throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`);
  }

  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function ensureWorkspace(cookie: string): Promise<void> {
  // Check if workspaces already exist
  const check = await fetch(`${AFFINE_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ query: "{ workspaces { id } }" }),
  });
  const checkData = (await check.json()) as any;
  if (checkData.data?.workspaces?.length > 0) {
    console.log(`Workspace already exists: ${checkData.data.workspaces[0].id}`);
    return;
  }

  // Create a workspace
  const res = await fetch(`${AFFINE_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ query: "mutation { createWorkspace { id } }" }),
  });
  const data = (await res.json()) as any;
  if (data.errors) {
    throw new Error(`Failed to create workspace: ${JSON.stringify(data.errors)}`);
  }
  console.log(`Created workspace: ${data.data.createWorkspace.id}`);
}

async function main() {
  await waitForAffine();
  await createAdminUser();

  console.log("Signing in to create workspace...");
  const cookie = await signIn();
  await ensureWorkspace(cookie);

  console.log("\nE2E setup complete. Ready to run tests.");
  console.log(`  AFFINE_BASE_URL=${AFFINE_URL}`);
  console.log(`  AFFINE_EMAIL=${TEST_EMAIL}`);
  console.log(`  AFFINE_PASSWORD=${TEST_PASSWORD}`);
}

main().catch((err) => {
  console.error("E2E setup failed:", err.message);
  process.exit(1);
});
