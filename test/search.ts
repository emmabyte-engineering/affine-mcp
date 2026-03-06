import "dotenv/config";
import { loadConfig, detectServerVersion } from "../src/config.js";
import { signIn } from "../src/auth.js";
import { GraphQLClient, LIST_DOCS } from "../src/graphql.js";
import { createSocket, setServerVersion } from "../src/websocket.js";
import { readDocContent, searchDocs } from "../src/doc-operations.js";

const query = process.argv[2] || "haven infinity";

async function main() {
  const config = loadConfig();
  const version = await detectServerVersion(config);
  setServerVersion(version);
  const cookie = await signIn(config);
  const gql = new GraphQLClient(config, cookie);

  // Get all doc IDs (paginate through all)
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
  console.log(`Searching ${allDocs.length} docs for "${query}"...\n`);

  const socket = createSocket(config, cookie);
  socket.connect();
  try {
    const results = await searchDocs(
      socket,
      "98e629ce-f10b-4389-9eab-370eaff83026",
      query,
      allDocs.map((d) => d.id)
    );

    if (results.length === 0) {
      console.log("No results found.");
    } else {
      for (const r of results) {
        console.log(`📄 ${r.title} (${r.docId})`);
        console.log(`   ${r.snippet}`);
        console.log();
      }
    }
  } finally {
    socket.disconnect();
  }
}

main().catch(console.error);
