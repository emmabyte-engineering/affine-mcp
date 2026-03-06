import "dotenv/config";
import { loadConfig, detectServerVersion } from "../src/config.js";
import { signIn } from "../src/auth.js";
import { GraphQLClient, LIST_DOCS } from "../src/graphql.js";
import { createSocket, setServerVersion } from "../src/websocket.js";
import {
  readMultipleDocs,
  getMermaidDiagrams,
  getDocLinks,
  getDocTables,
} from "../src/doc-operations.js";
import type { Socket } from "socket.io-client";

async function useSocket<T>(
  config: ReturnType<typeof loadConfig>,
  cookie: string | undefined,
  fn: (socket: Socket) => Promise<T>
): Promise<T> {
  const socket = createSocket(config, cookie);
  socket.connect();
  try { return await fn(socket); }
  finally { socket.disconnect(); }
}

async function main() {
  const config = loadConfig();
  const version = await detectServerVersion(config);
  setServerVersion(version);
  const cookie = await signIn(config);
  const gql = new GraphQLClient(config, cookie);
  const wsId = "98e629ce-f10b-4389-9eab-370eaff83026";

  // Get all doc IDs
  const allDocs: Array<{ id: string; title: string }> = [];
  let hasMore = true;
  let cursor: string | undefined;
  while (hasMore) {
    const vars: Record<string, unknown> = { workspaceId: wsId, first: 50 };
    if (cursor) vars.after = cursor;
    const data = await gql.query<{ workspace: { docs: any } }>(LIST_DOCS, vars);
    for (const e of data.workspace.docs.edges) {
      allDocs.push({ id: e.node.id, title: e.node.title });
    }
    hasMore = data.workspace.docs.pageInfo.hasNextPage;
    cursor = data.workspace.docs.pageInfo.endCursor;
  }
  console.log(`Workspace has ${allDocs.length} docs\n`);

  // ═══════════════════════════════════════
  // 1. MERMAID — scan all docs for diagrams
  // ═══════════════════════════════════════
  console.log("━━━ Mermaid Diagrams Across Workspace ━━━\n");
  let totalMermaid = 0;
  for (const doc of allDocs) {
    try {
      const result = await useSocket(config, cookie, (socket) =>
        getMermaidDiagrams(socket, wsId, doc.id)
      );
      if (result.diagrams.length > 0) {
        totalMermaid += result.diagrams.length;
        console.log(`📊 "${result.title}" (${doc.id}) — ${result.diagrams.length} diagram(s)`);
        for (const d of result.diagrams) {
          const firstLine = d.code.split("\n")[0];
          console.log(`   [${d.blockId}] ${firstLine} (${d.code.length} chars)`);
        }
      }
    } catch {}
  }
  console.log(`\nTotal: ${totalMermaid} mermaid diagrams across workspace\n`);

  // ═══════════════════════════════════════
  // 2. TABLES — scan all docs for tables
  // ═══════════════════════════════════════
  console.log("━━━ Tables Across Workspace ━━━\n");
  let totalTables = 0;
  for (const doc of allDocs) {
    try {
      const result = await useSocket(config, cookie, (socket) =>
        getDocTables(socket, wsId, doc.id)
      );
      if (result.tables.length > 0) {
        totalTables += result.tables.length;
        console.log(`📋 "${result.title}" (${doc.id}) — ${result.tables.length} table(s)`);
        for (const t of result.tables) {
          console.log(`   [${t.blockId}] ${t.headers.join(" | ")} (${t.rows.length} rows)`);
        }
      }
    } catch {}
  }
  console.log(`\nTotal: ${totalTables} tables across workspace\n`);

  // ═══════════════════════════════════════
  // 3. BULK READ — read a batch of docs
  // ═══════════════════════════════════════
  console.log("━━━ Bulk Read (first 10 docs) ━━━\n");
  const batchIds = allDocs.slice(0, 10).map((d) => d.id);
  const bulkResults = await useSocket(config, cookie, (socket) =>
    readMultipleDocs(socket, wsId, batchIds)
  );
  for (const r of bulkResults) {
    if (r.error) {
      console.log(`  ✗ ${r.docId}: ${r.error}`);
    } else {
      console.log(`  ✓ "${r.title}" (${r.docId}): ${r.markdown.length} chars`);
    }
  }
  console.log();

  // ═══════════════════════════════════════
  // 4. DOC LINK GRAPH — full workspace
  // ═══════════════════════════════════════
  console.log("━━━ Doc Link Graph (full workspace) ━━━\n");
  const allIds = allDocs.map((d) => d.id);
  const links = await useSocket(config, cookie, (socket) =>
    getDocLinks(socket, wsId, allIds)
  );

  // Build adjacency
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  const titleMap = new Map<string, string>();
  for (const d of allDocs) titleMap.set(d.id, d.title);

  for (const link of links) {
    if (!outbound.has(link.sourceDocId)) outbound.set(link.sourceDocId, new Set());
    outbound.get(link.sourceDocId)!.add(link.targetDocId);
    if (!inbound.has(link.targetDocId)) inbound.set(link.targetDocId, new Set());
    inbound.get(link.targetDocId)!.add(link.sourceDocId);
  }

  const allDocSet = new Set(allIds);
  const orphaned = allIds.filter((id) => !inbound.has(id) && !outbound.has(id));
  const brokenLinks = links.filter((l) => !allDocSet.has(l.targetDocId));

  console.log(`Total links: ${links.length}`);
  console.log(`Docs with outbound links: ${outbound.size}`);
  console.log(`Docs with inbound links: ${inbound.size}`);
  console.log(`Orphaned docs (no links in or out): ${orphaned.length}`);
  console.log(`Broken links (target doesn't exist): ${brokenLinks.length}`);

  if (orphaned.length > 0) {
    console.log(`\nOrphaned docs:`);
    for (const id of orphaned) {
      console.log(`  • "${titleMap.get(id) || "untitled"}" (${id})`);
    }
  }

  if (brokenLinks.length > 0) {
    console.log(`\nBroken internal links:`);
    for (const l of brokenLinks) {
      console.log(`  ✗ "${l.sourceDocTitle}" (${l.sourceDocId}) → missing: ${l.targetDocId}`);
    }
  }

  // Most connected docs
  const connectionCount = new Map<string, number>();
  for (const id of allIds) {
    const out = outbound.get(id)?.size || 0;
    const inc = inbound.get(id)?.size || 0;
    connectionCount.set(id, out + inc);
  }
  const sorted = Array.from(connectionCount.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\nMost connected docs:`);
  for (const [id, count] of sorted.slice(0, 10)) {
    const inc = inbound.get(id)?.size || 0;
    const out = outbound.get(id)?.size || 0;
    console.log(`  ${count} links — "${titleMap.get(id) || "untitled"}" (${id}) [${inc} in, ${out} out]`);
  }

  console.log("\n✓ All feature tests complete.");
}

main().catch(console.error);
