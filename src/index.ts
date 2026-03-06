#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, detectServerVersion, type AffineConfig } from "./config.js";

const MAX_MARKDOWN_LENGTH = 1_000_000; // 1MB
const MAX_DOC_IDS = 100;
const MAX_TABLE_ROWS = 10_000;
const MAX_TABLE_COLS = 200;

const markdownInput = z.string().max(MAX_MARKDOWN_LENGTH, "Markdown content exceeds 1MB limit");
const docIdsInput = z.array(z.string()).max(MAX_DOC_IDS, `Cannot process more than ${MAX_DOC_IDS} docs at once`);
const headersInput = z.array(z.string()).max(MAX_TABLE_COLS, `Tables cannot exceed ${MAX_TABLE_COLS} columns`);
const rowsInput = z.array(z.array(z.string())).max(MAX_TABLE_ROWS, `Tables cannot exceed ${MAX_TABLE_ROWS} rows`);
import { signIn } from "./auth.js";
import {
  GraphQLClient,
  LIST_WORKSPACES,
  GET_WORKSPACE,
  LIST_DOCS,
  GET_DOC,
} from "./graphql.js";
import { createSocket, setServerVersion } from "./websocket.js";
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
} from "./doc-operations.js";
import type { Socket } from "socket.io-client";

const config = loadConfig();
let gql: GraphQLClient;
let sessionCookie: string | undefined;

async function init() {
  const version = await detectServerVersion(config);
  setServerVersion(version);
  sessionCookie = await signIn(config);
  gql = new GraphQLClient(config, sessionCookie);
}

function withSocket<T>(fn: (socket: Socket) => Promise<T>): Promise<T> {
  const socket = createSocket(config, sessionCookie);
  socket.connect();
  return fn(socket).finally(() => socket.disconnect());
}

async function getAllDocIds(workspaceId: string): Promise<string[]> {
  const allDocIds: string[] = [];
  let hasMore = true;
  let cursor: string | undefined;
  while (hasMore) {
    const vars: Record<string, unknown> = { workspaceId, first: 50 };
    if (cursor) vars.after = cursor;
    const data = await gql.query<{ workspace: { docs: any } }>(LIST_DOCS, vars);
    const docs = data.workspace.docs;
    for (const edge of docs.edges) {
      allDocIds.push(edge.node.id);
    }
    hasMore = docs.pageInfo.hasNextPage;
    cursor = docs.pageInfo.endCursor;
  }
  return allDocIds;
}

// --- MCP Server ---

const server = new McpServer({
  name: "affine-mcp",
  version: "1.0.0",
});

// ============================================================
// Workspace Tools
// ============================================================

server.tool(
  "list_workspaces",
  "List all workspaces accessible to the authenticated user",
  {},
  async () => {
    const data = await gql.query<{ workspaces: any[] }>(LIST_WORKSPACES);
    return {
      content: [{ type: "text", text: JSON.stringify(data.workspaces, null, 2) }],
    };
  }
);

server.tool(
  "get_workspace",
  "Get details for a specific workspace",
  { workspaceId: z.string().describe("The workspace ID") },
  async ({ workspaceId }) => {
    const data = await gql.query<{ workspace: any }>(GET_WORKSPACE, { id: workspaceId });
    return {
      content: [{ type: "text", text: JSON.stringify(data.workspace, null, 2) }],
    };
  }
);

// ============================================================
// Document Tools
// ============================================================

server.tool(
  "list_docs",
  "List documents in a workspace with pagination",
  {
    workspaceId: z.string().describe("The workspace ID"),
    first: z.number().optional().default(20).describe("Number of docs to return (default 20)"),
    after: z.string().optional().describe("Cursor for pagination (from previous response)"),
  },
  async ({ workspaceId, first, after }) => {
    const vars: Record<string, unknown> = { workspaceId, first };
    if (after) vars.after = after;

    const data = await gql.query<{ workspace: { docs: any } }>(LIST_DOCS, vars);
    const docs = data.workspace.docs;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              totalCount: docs.totalCount,
              hasNextPage: docs.pageInfo.hasNextPage,
              endCursor: docs.pageInfo.endCursor,
              docs: docs.edges.map((e: any) => e.node),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_doc",
  "Get metadata for a specific document",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
  },
  async ({ workspaceId, docId }) => {
    const data = await gql.query<{ workspace: { doc: any } }>(GET_DOC, { workspaceId, docId });
    return {
      content: [{ type: "text", text: JSON.stringify(data.workspace.doc, null, 2) }],
    };
  }
);

server.tool(
  "read_doc",
  "Read the full content of a document, returned as markdown",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
  },
  async ({ workspaceId, docId }) => {
    const result = await withSocket((socket) => readDocContent(socket, workspaceId, docId));
    return {
      content: [{ type: "text", text: `# ${result.title}\n\n${result.markdown}` }],
    };
  }
);

server.tool(
  "read_multiple_docs",
  "Read multiple documents at once. Returns each doc's title and markdown content. Use this for bulk operations and cross-referencing.",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docIds: docIdsInput.describe("Array of document IDs to read"),
  },
  async ({ workspaceId, docIds }) => {
    const results = await withSocket((socket) => readMultipleDocs(socket, workspaceId, docIds));
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "search_docs",
  "Search for documents containing a text query. Searches through document titles and content.",
  {
    workspaceId: z.string().describe("The workspace ID"),
    query: z.string().describe("Text to search for"),
    maxResults: z.number().optional().default(10).describe("Maximum number of results to return (default 10)"),
  },
  async ({ workspaceId, query, maxResults }) => {
    const allDocIds = await getAllDocIds(workspaceId);
    const results = await withSocket((socket) => searchDocs(socket, workspaceId, query, allDocIds));
    const limited = results.slice(0, maxResults);

    return {
      content: [
        {
          type: "text",
          text: limited.length === 0
            ? "No documents found matching the query."
            : JSON.stringify(limited, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "create_doc",
  "Create a new document with optional markdown content",
  {
    workspaceId: z.string().describe("The workspace ID"),
    title: z.string().describe("Document title"),
    markdown: markdownInput.optional().describe("Optional markdown content for the document body"),
  },
  async ({ workspaceId, title, markdown }) => {
    const docId = await withSocket((socket) => createDocument(socket, workspaceId, title, markdown));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { docId, title, url: `${config.baseUrl}/workspace/${workspaceId}/${docId}` },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "append_to_doc",
  "Append markdown content to the end of an existing document",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
    markdown: markdownInput.describe("Markdown content to append"),
  },
  async ({ workspaceId, docId, markdown }) => {
    await withSocket((socket) => appendMarkdownToDoc(socket, workspaceId, docId, markdown));
    return { content: [{ type: "text", text: "Content appended successfully." }] };
  }
);

server.tool(
  "replace_doc_content",
  "Replace the entire content of a document with new markdown. Optionally update the title.",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
    markdown: markdownInput.describe("New markdown content to replace the document body"),
    title: z.string().optional().describe("Optional new title for the document"),
  },
  async ({ workspaceId, docId, markdown, title }) => {
    await withSocket((socket) => replaceDocContent(socket, workspaceId, docId, markdown, title));
    return { content: [{ type: "text", text: "Document content replaced successfully." }] };
  }
);

server.tool(
  "delete_doc",
  "Delete a document from a workspace",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID to delete"),
  },
  async ({ workspaceId, docId }) => {
    await withSocket((socket) => removeDoc(socket, workspaceId, docId));
    return { content: [{ type: "text", text: `Document ${docId} deleted.` }] };
  }
);

// ============================================================
// Mermaid Diagram Tools
// ============================================================

server.tool(
  "get_mermaid_diagrams",
  "Get all mermaid diagrams from a document. Returns each diagram's block ID and code.",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
  },
  async ({ workspaceId, docId }) => {
    const result = await withSocket((socket) => getMermaidDiagrams(socket, workspaceId, docId));
    return {
      content: [
        {
          type: "text",
          text: result.diagrams.length === 0
            ? `No mermaid diagrams found in "${result.title}".`
            : JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "update_mermaid_diagram",
  "Update an existing mermaid diagram in a document by its block ID",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
    blockId: z.string().describe("The block ID of the mermaid diagram (from get_mermaid_diagrams)"),
    code: z.string().describe("New mermaid diagram code"),
  },
  async ({ workspaceId, docId, blockId, code }) => {
    await withSocket((socket) => updateMermaidDiagram(socket, workspaceId, docId, blockId, code));
    return { content: [{ type: "text", text: "Mermaid diagram updated successfully." }] };
  }
);

server.tool(
  "insert_mermaid_diagram",
  "Insert a new mermaid diagram at the end of a document",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
    code: z.string().describe("Mermaid diagram code"),
  },
  async ({ workspaceId, docId, code }) => {
    const blockId = await withSocket((socket) => insertMermaidDiagram(socket, workspaceId, docId, code));
    return {
      content: [{ type: "text", text: JSON.stringify({ blockId, message: "Mermaid diagram inserted." }, null, 2) }],
    };
  }
);

// ============================================================
// Doc Link Graph Tools
// ============================================================

server.tool(
  "get_doc_link_graph",
  "Get the link graph for all documents in a workspace. Shows which docs link to which other docs via embedded linked-doc blocks. Useful for finding orphaned docs, understanding doc relationships, and navigating the knowledge base.",
  {
    workspaceId: z.string().describe("The workspace ID"),
  },
  async ({ workspaceId }) => {
    const allDocIds = await getAllDocIds(workspaceId);
    const links = await withSocket((socket) => getDocLinks(socket, workspaceId, allDocIds));

    // Build adjacency info
    const inbound = new Map<string, string[]>();
    const outbound = new Map<string, string[]>();
    for (const link of links) {
      if (!outbound.has(link.sourceDocId)) outbound.set(link.sourceDocId, []);
      outbound.get(link.sourceDocId)!.push(link.targetDocId);
      if (!inbound.has(link.targetDocId)) inbound.set(link.targetDocId, []);
      inbound.get(link.targetDocId)!.push(link.sourceDocId);
    }

    // Find orphans (docs with no inbound links and not linking to anything)
    const allDocSet = new Set(allDocIds);
    const orphaned = allDocIds.filter(
      (id) => !inbound.has(id) && !outbound.has(id)
    );

    // Find docs linked to that don't exist
    const brokenLinks = links.filter((l) => !allDocSet.has(l.targetDocId));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              totalDocs: allDocIds.length,
              totalLinks: links.length,
              orphanedDocs: orphaned,
              brokenLinks: brokenLinks.map((l) => ({
                from: `${l.sourceDocTitle} (${l.sourceDocId})`,
                missingTarget: l.targetDocId,
              })),
              links: links.map((l) => ({
                from: `${l.sourceDocTitle} (${l.sourceDocId})`,
                to: l.targetDocId,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ============================================================
// Table Tools
// ============================================================

server.tool(
  "get_tables",
  "Get all tables from a document. Returns structured table data with headers and rows.",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
  },
  async ({ workspaceId, docId }) => {
    const result = await withSocket((socket) => getDocTables(socket, workspaceId, docId));
    return {
      content: [
        {
          type: "text",
          text: result.tables.length === 0
            ? `No tables found in "${result.title}".`
            : JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "insert_table",
  "Insert a new table at the end of a document",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
    headers: headersInput.describe("Column header names"),
    rows: rowsInput.describe("Array of rows, each row is an array of cell values"),
  },
  async ({ workspaceId, docId, headers, rows }) => {
    const blockId = await withSocket((socket) => insertTable(socket, workspaceId, docId, headers, rows));
    return {
      content: [{ type: "text", text: JSON.stringify({ blockId, message: "Table inserted." }, null, 2) }],
    };
  }
);

server.tool(
  "update_table",
  "Replace an existing table's content by its block ID",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
    blockId: z.string().describe("The block ID of the table (from get_tables)"),
    headers: headersInput.describe("New column header names"),
    rows: rowsInput.describe("New rows, each row is an array of cell values"),
  },
  async ({ workspaceId, docId, blockId, headers, rows }) => {
    await withSocket((socket) => updateTable(socket, workspaceId, docId, blockId, headers, rows));
    return { content: [{ type: "text", text: "Table updated successfully." }] };
  }
);

// ============================================================
// Comment Tools
// ============================================================

server.tool(
  "get_comments",
  "Get all comments on a document. Returns each comment's author, content, resolved status, and the text it's anchored to (if any). Also includes replies. Useful for reviewing feedback, finding issues flagged by collaborators, and tracking comment threads.",
  {
    workspaceId: z.string().describe("The workspace ID"),
    docId: z.string().describe("The document ID"),
  },
  async ({ workspaceId, docId }) => {
    const result = await withSocket((socket) =>
      getDocComments(gql, socket, workspaceId, docId)
    );
    return {
      content: [
        {
          type: "text",
          text: result.comments.length === 0
            ? `No comments found on "${result.title}".`
            : JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// --- Start Server ---

async function main() {
  await init();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
