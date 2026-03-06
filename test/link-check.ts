import "dotenv/config";
import { loadConfig, detectServerVersion } from "../src/config.js";
import { signIn } from "../src/auth.js";
import { GraphQLClient, LIST_DOCS } from "../src/graphql.js";
import { createSocket, setServerVersion } from "../src/websocket.js";
import { readDocContent } from "../src/doc-operations.js";

const URL_REGEX = /https?:\/\/[^\s)\]>"',]+/g;

interface LinkResult {
  url: string;
  status: number | string;
  doc: string;
  docId: string;
}

async function checkUrl(url: string): Promise<{ status: number | string }> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "affine-mcp-link-checker/1.0" },
    });
    return { status: res.status };
  } catch (err: any) {
    // Some servers reject HEAD, try GET
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "affine-mcp-link-checker/1.0" },
      });
      return { status: res.status };
    } catch (err2: any) {
      return { status: err2.cause?.code || err2.message || "ERROR" };
    }
  }
}

async function main() {
  const config = loadConfig();
  const version = await detectServerVersion(config);
  setServerVersion(version);
  const cookie = await signIn(config);
  const gql = new GraphQLClient(config, cookie);

  // Get all docs
  const allDocs: Array<{ id: string; title: string }> = [];
  let hasMore = true;
  let cursor: string | undefined;
  while (hasMore) {
    const vars: Record<string, unknown> = {
      workspaceId: "98e629ce-f10b-4389-9eab-370eaff83026",
      first: 50,
    };
    if (cursor) vars.after = cursor;
    const data = await gql.query<{ workspace: { docs: any } }>(LIST_DOCS, vars);
    for (const e of data.workspace.docs.edges) {
      allDocs.push({ id: e.node.id, title: e.node.title });
    }
    hasMore = data.workspace.docs.pageInfo.hasNextPage;
    cursor = data.workspace.docs.pageInfo.endCursor;
  }

  console.log(`Found ${allDocs.length} docs. Reading content and extracting links...\n`);

  // Read all docs and extract URLs
  const urlMap = new Map<string, Array<{ doc: string; docId: string }>>();

  const socket = createSocket(config, cookie);
  socket.connect();
  try {
    for (const doc of allDocs) {
      try {
        const content = await readDocContent(
          socket,
          "98e629ce-f10b-4389-9eab-370eaff83026",
          doc.id
        );
        const fullText = content.markdown;
        const urls = fullText.match(URL_REGEX) || [];
        for (let url of urls) {
          // Clean trailing punctuation
          url = url.replace(/[.,;:!?)]+$/, "");
          // Skip internal affine:// links
          if (url.startsWith("affine://")) continue;

          if (!urlMap.has(url)) urlMap.set(url, []);
          urlMap.get(url)!.push({ doc: doc.title || doc.id, docId: doc.id });
        }
      } catch {
        // skip unreadable docs
      }
    }
  } finally {
    socket.disconnect();
  }

  const uniqueUrls = Array.from(urlMap.keys());
  console.log(`Extracted ${uniqueUrls.length} unique URLs. Checking...\n`);

  // Check URLs in batches of 10
  const broken: LinkResult[] = [];
  const ok: LinkResult[] = [];
  const BATCH = 10;

  for (let i = 0; i < uniqueUrls.length; i += BATCH) {
    const batch = uniqueUrls.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (url) => {
        const result = await checkUrl(url);
        return { url, ...result };
      })
    );

    for (const r of results) {
      const docs = urlMap.get(r.url)!;
      const entry: LinkResult = {
        url: r.url,
        status: r.status,
        doc: docs[0].doc,
        docId: docs[0].docId,
      };

      if (typeof r.status === "number" && r.status >= 200 && r.status < 400) {
        ok.push(entry);
        process.stdout.write(".");
      } else {
        broken.push(entry);
        process.stdout.write("✗");
      }
    }
  }

  console.log("\n");

  // Report
  if (broken.length === 0) {
    console.log("All links are valid!");
  } else {
    console.log(`Found ${broken.length} broken/problematic link(s):\n`);
    // Group by status
    const byStatus = new Map<string, LinkResult[]>();
    for (const b of broken) {
      const key = String(b.status);
      if (!byStatus.has(key)) byStatus.set(key, []);
      byStatus.get(key)!.push(b);
    }

    for (const [status, links] of Array.from(byStatus.entries()).sort()) {
      console.log(`── Status: ${status} ──`);
      for (const l of links) {
        const allDocs = urlMap.get(l.url)!;
        const docList = allDocs.map((d) => `"${d.doc}" (${d.docId})`).join(", ");
        console.log(`  ${l.url}`);
        console.log(`    Found in: ${docList}`);
      }
      console.log();
    }
  }

  console.log(`Summary: ${ok.length} ok, ${broken.length} broken out of ${uniqueUrls.length} unique URLs`);
}

main().catch(console.error);
