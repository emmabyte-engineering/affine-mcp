import "dotenv/config";
import { loadConfig, detectServerVersion } from "../src/config.js";
import { signIn } from "../src/auth.js";
import { GraphQLClient, LIST_WORKSPACES, LIST_DOCS, GET_DOC } from "../src/graphql.js";
import { createSocket, setServerVersion } from "../src/websocket.js";
import {
  readDocContent,
  readMultipleDocs,
  createDocument,
  appendMarkdownToDoc,
  replaceDocContent,
  removeDoc,
  searchDocs,
  getMermaidDiagrams,
  updateMermaidDiagram,
  insertMermaidDiagram,
  getDocLinks,
  getDocTables,
  insertTable,
  updateTable,
  getDocComments,
} from "../src/doc-operations.js";
import { GraphQLClient } from "../src/graphql.js";
import type { Socket } from "socket.io-client";

// --- Helpers ---

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n━━━ ${name} ━━━`);
}

async function useSocket<T>(
  config: ReturnType<typeof loadConfig>,
  cookie: string | undefined,
  fn: (socket: Socket) => Promise<T>
): Promise<T> {
  const socket = createSocket(config, cookie);
  socket.connect();
  try {
    return await fn(socket);
  } finally {
    socket.disconnect();
  }
}

// --- Main ---

async function main() {
  const config = loadConfig();
  console.log(`Testing against: ${config.baseUrl}`);

  const version = await detectServerVersion(config);
  setServerVersion(version);
  console.log(`Server version: ${version}\n`);

  // 1. Auth
  section("Authentication");
  let cookie: string | undefined;
  try {
    cookie = await signIn(config);
    const method = config.token ? "token" : cookie ? "email/password" : config.cookie ? "cookie" : "none";
    assert(true, `Authenticated via ${method}`);
  } catch (err: any) {
    assert(false, `Authentication failed: ${err.message}`);
    process.exit(1);
  }

  const gql = new GraphQLClient(config, cookie);

  // 2. List workspaces
  section("List Workspaces");
  let workspaceId: string;
  try {
    const data = await gql.query<{ workspaces: any[] }>(LIST_WORKSPACES);
    assert(Array.isArray(data.workspaces), `Got ${data.workspaces.length} workspace(s)`);
    assert(data.workspaces.length > 0, "At least one workspace exists");
    workspaceId = data.workspaces[0].id;
    console.log(`  → Using workspace: ${workspaceId}`);
  } catch (err: any) {
    assert(false, `List workspaces failed: ${err.message}`);
    process.exit(1);
  }

  // 3. List docs
  section("List Docs");
  let existingDocIds: string[] = [];
  try {
    const data = await gql.query<{ workspace: { docs: any } }>(LIST_DOCS, { workspaceId, first: 10 });
    const docs = data.workspace.docs;
    assert(docs.totalCount !== undefined, `Total docs: ${docs.totalCount}`);
    assert(Array.isArray(docs.edges), `Got ${docs.edges.length} doc(s) in page`);
    existingDocIds = docs.edges.map((e: any) => e.node.id);
    if (docs.edges.length > 0) {
      const first = docs.edges[0].node;
      console.log(`  → First doc: "${first.title}" (${first.id})`);
    }
  } catch (err: any) {
    assert(false, `List docs failed: ${err.message}`);
  }

  // 4. Create doc with rich content
  section("Create Doc");
  let createdDocId: string | undefined;
  try {
    const testMarkdown = `## Test Section

This is a test document created by the integration test.

- Item one
- Item two
- Item three

### Code Example

\`\`\`javascript
console.log("hello from affine-mcp");
\`\`\`

> A blockquote for testing.

---

1. First
2. Second
3. Third`;

    createdDocId = await useSocket(config, cookie, (socket) =>
      createDocument(socket, workspaceId, "MCP Integration Test", testMarkdown)
    );
    assert(!!createdDocId, `Created doc: ${createdDocId}`);
  } catch (err: any) {
    assert(false, `Create doc failed: ${err.message}`);
  }

  if (!createdDocId) {
    console.log("\nSkipping remaining tests (doc creation failed)");
    process.exit(1);
  }

  // 5. Read doc
  section("Read Doc");
  try {
    const result = await useSocket(config, cookie, (socket) =>
      readDocContent(socket, workspaceId, createdDocId!)
    );
    assert(result.title === "MCP Integration Test", `Title: "${result.title}"`);
    assert(result.markdown.includes("Test Section"), "Markdown contains heading");
    assert(result.markdown.includes("Item one"), "Markdown contains list item");
    assert(result.markdown.includes("console.log"), "Markdown contains code");
    assert(result.plainText.length > 0, `Plain text length: ${result.plainText.length}`);
  } catch (err: any) {
    assert(false, `Read doc failed: ${err.message}`);
  }

  // 6. Bulk read
  section("Bulk Read");
  try {
    const docsToRead = [createdDocId, ...existingDocIds.slice(0, 2)];
    const results = await useSocket(config, cookie, (socket) =>
      readMultipleDocs(socket, workspaceId, docsToRead)
    );
    assert(results.length === docsToRead.length, `Read ${results.length} docs`);
    const successCount = results.filter((r) => !r.error).length;
    assert(successCount >= 1, `${successCount} docs read successfully`);
    for (const r of results) {
      if (r.error) {
        console.log(`  → ${r.docId}: ERROR - ${r.error}`);
      } else {
        console.log(`  → "${r.title}" (${r.docId}): ${r.markdown.length} chars`);
      }
    }
  } catch (err: any) {
    assert(false, `Bulk read failed: ${err.message}`);
  }

  // 7. Get doc metadata via GraphQL
  section("Get Doc Metadata (GraphQL)");
  try {
    const data = await gql.query<{ workspace: { doc: any } }>(GET_DOC, { workspaceId, docId: createdDocId });
    assert(!!data.workspace.doc, "Got doc metadata");
  } catch (err: any) {
    assert(false, `Get doc metadata failed: ${err.message}`);
  }

  // 8. Append to doc
  section("Append to Doc");
  try {
    await useSocket(config, cookie, (socket) =>
      appendMarkdownToDoc(socket, workspaceId, createdDocId!, "\n## Appended Section\n\nThis was appended by the test.")
    );
    assert(true, "Append call succeeded");

    const result = await useSocket(config, cookie, (socket) =>
      readDocContent(socket, workspaceId, createdDocId!)
    );
    assert(result.markdown.includes("Appended Section"), "Appended heading found in re-read");
  } catch (err: any) {
    assert(false, `Append failed: ${err.message}`);
  }

  // 9. Replace doc content
  section("Replace Doc Content");
  try {
    await useSocket(config, cookie, (socket) =>
      replaceDocContent(socket, workspaceId, createdDocId!, "## Replaced Content\n\nThis document was completely replaced.", "Replaced Test Doc")
    );
    assert(true, "Replace call succeeded");

    const result = await useSocket(config, cookie, (socket) =>
      readDocContent(socket, workspaceId, createdDocId!)
    );
    assert(result.title === "Replaced Test Doc", `Updated title: "${result.title}"`);
    assert(result.markdown.includes("Replaced Content"), "New heading found");
    assert(!result.markdown.includes("Test Section"), "Old content removed");
  } catch (err: any) {
    assert(false, `Replace failed: ${err.message}`);
  }

  // 10. Mermaid: insert
  section("Mermaid: Insert Diagram");
  let mermaidBlockId: string | undefined;
  try {
    const mermaidCode = `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`;

    mermaidBlockId = await useSocket(config, cookie, (socket) =>
      insertMermaidDiagram(socket, workspaceId, createdDocId!, mermaidCode)
    );
    assert(!!mermaidBlockId, `Inserted mermaid block: ${mermaidBlockId}`);
  } catch (err: any) {
    assert(false, `Insert mermaid failed: ${err.message}`);
  }

  // 11. Mermaid: read
  section("Mermaid: Get Diagrams");
  try {
    const result = await useSocket(config, cookie, (socket) =>
      getMermaidDiagrams(socket, workspaceId, createdDocId!)
    );
    assert(result.diagrams.length > 0, `Found ${result.diagrams.length} mermaid diagram(s)`);
    if (result.diagrams.length > 0) {
      assert(result.diagrams[0].code.includes("flowchart"), "Diagram contains flowchart code");
      console.log(`  → Block: ${result.diagrams[0].blockId}, code length: ${result.diagrams[0].code.length}`);
    }
  } catch (err: any) {
    assert(false, `Get mermaid failed: ${err.message}`);
  }

  // 12. Mermaid: update
  if (mermaidBlockId) {
    section("Mermaid: Update Diagram");
    try {
      const updatedCode = `flowchart LR
    A[Input] --> B[Process]
    B --> C[Output]`;

      await useSocket(config, cookie, (socket) =>
        updateMermaidDiagram(socket, workspaceId, createdDocId!, mermaidBlockId!, updatedCode)
      );
      assert(true, "Update call succeeded");

      const result = await useSocket(config, cookie, (socket) =>
        getMermaidDiagrams(socket, workspaceId, createdDocId!)
      );
      assert(result.diagrams[0]?.code.includes("flowchart LR"), "Updated code found in re-read");
    } catch (err: any) {
      assert(false, `Update mermaid failed: ${err.message}`);
    }
  }

  // 13. Table: insert
  section("Table: Insert");
  let tableBlockId: string | undefined;
  try {
    tableBlockId = await useSocket(config, cookie, (socket) =>
      insertTable(socket, workspaceId, createdDocId!, ["Service", "Host", "Port", "Status"], [
        ["SSH", "10.0.0.1", "22", "Active"],
        ["HTTP", "10.0.0.2", "80", "Active"],
        ["PostgreSQL", "10.0.0.3", "5432", "Maintenance"],
      ])
    );
    assert(!!tableBlockId, `Inserted table block: ${tableBlockId}`);
  } catch (err: any) {
    assert(false, `Insert table failed: ${err.message}`);
  }

  // 14. Table: read
  section("Table: Get Tables");
  try {
    const result = await useSocket(config, cookie, (socket) =>
      getDocTables(socket, workspaceId, createdDocId!)
    );
    assert(result.tables.length > 0, `Found ${result.tables.length} table(s)`);
    if (result.tables.length > 0) {
      const t = result.tables[0];
      assert(t.headers.includes("Service"), "Table has Service header");
      assert(t.rows.length === 3, `Table has ${t.rows.length} data rows`);
      assert(t.rows[0].includes("SSH"), "First row contains SSH");
      console.log(`  → Headers: ${t.headers.join(", ")}`);
      for (const row of t.rows) {
        console.log(`  → Row: ${row.join(", ")}`);
      }
    }
  } catch (err: any) {
    assert(false, `Get tables failed: ${err.message}`);
  }

  // 15. Table: update
  if (tableBlockId) {
    section("Table: Update");
    try {
      await useSocket(config, cookie, (socket) =>
        updateTable(socket, workspaceId, createdDocId!, tableBlockId!, ["Service", "Host", "Port", "Status", "Notes"], [
          ["SSH", "10.0.0.1", "22", "Active", "Key-based auth"],
          ["HTTP", "10.0.0.2", "443", "Active", "Upgraded to HTTPS"],
          ["PostgreSQL", "10.0.0.3", "5432", "Active", "Maintenance complete"],
          ["Redis", "10.0.0.4", "6379", "Active", "New service"],
        ])
      );
      assert(true, "Table update call succeeded");

      const result = await useSocket(config, cookie, (socket) =>
        getDocTables(socket, workspaceId, createdDocId!)
      );
      const t = result.tables.find((t) => t.blockId === tableBlockId);
      assert(!!t, "Found updated table by block ID");
      if (t) {
        assert(t.headers.length === 5, `Updated table has ${t.headers.length} columns`);
        assert(t.rows.length === 4, `Updated table has ${t.rows.length} rows`);
        assert(t.rows.some((r) => r.includes("Redis")), "New row (Redis) found");
      }
    } catch (err: any) {
      assert(false, `Update table failed: ${err.message}`);
    }
  }

  // 16. Read back full doc to verify mermaid and table render in markdown
  section("Verify Full Markdown Render");
  try {
    const result = await useSocket(config, cookie, (socket) =>
      readDocContent(socket, workspaceId, createdDocId!)
    );
    assert(result.markdown.includes("```mermaid"), "Mermaid renders as fenced code block");
    assert(result.markdown.includes("| Service"), "Table renders as markdown table");
    assert(result.markdown.includes("| Redis"), "Table includes new Redis row");

    console.log(`\n  --- Full Markdown ---`);
    console.log(result.markdown.split("\n").map((l) => `  | ${l}`).join("\n"));
    console.log(`  --- End ---`);
  } catch (err: any) {
    assert(false, `Full markdown render failed: ${err.message}`);
  }

  // 17. Search docs
  section("Search Docs");
  try {
    const allDocIds = [...existingDocIds, createdDocId];
    const results = await useSocket(config, cookie, (socket) =>
      searchDocs(socket, workspaceId, "Replaced", allDocIds)
    );
    assert(results.length > 0, `Found ${results.length} result(s) for "Replaced"`);
  } catch (err: any) {
    assert(false, `Search failed: ${err.message}`);
  }

  // 18. Doc link graph (just test it runs on a few docs)
  section("Doc Link Graph");
  try {
    const testIds = existingDocIds.slice(0, 5);
    const links = await useSocket(config, cookie, (socket) =>
      getDocLinks(socket, workspaceId, testIds)
    );
    assert(Array.isArray(links), `Found ${links.length} link(s) across ${testIds.length} docs`);
    for (const l of links.slice(0, 3)) {
      console.log(`  → "${l.sourceDocTitle}" (${l.sourceDocId}) → ${l.targetDocId}`);
    }
    if (links.length > 3) console.log(`  → ... and ${links.length - 3} more`);
  } catch (err: any) {
    assert(false, `Doc link graph failed: ${err.message}`);
  }

  // 19. Delete doc (cleanup)
  section("Delete Doc (cleanup)");
  try {
    await useSocket(config, cookie, (socket) => removeDoc(socket, workspaceId, createdDocId!));
    assert(true, `Deleted doc ${createdDocId}`);
  } catch (err: any) {
    assert(false, `Delete failed: ${err.message}`);
  }

  // Summary
  console.log(`\n${"═".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
