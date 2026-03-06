import "dotenv/config";
import { loadConfig, detectServerVersion } from "../src/config.js";
import { signIn } from "../src/auth.js";
import { createSocket, setServerVersion, joinWorkspace, loadDoc, extractBlocks } from "../src/websocket.js";

const docId = process.argv[2];
const filter = process.argv[3]; // optional flavour filter

async function main() {
  const config = loadConfig();
  const version = await detectServerVersion(config);
  setServerVersion(version);
  const cookie = await signIn(config);

  const socket = createSocket(config, cookie);
  socket.connect();
  try {
    await joinWorkspace(socket, "98e629ce-f10b-4389-9eab-370eaff83026");
    const doc = await loadDoc(socket, "98e629ce-f10b-4389-9eab-370eaff83026", docId);
    const blocks = extractBlocks(doc);

    for (const [id, block] of blocks) {
      if (filter && !block.flavour.includes(filter)) continue;
      console.log(`\n═══ ${block.flavour} (${id}) type=${block.type || "–"} ═══`);
      if (block.text !== undefined) {
        const preview = block.text.length > 200 ? block.text.slice(0, 200) + "..." : block.text;
        console.log(`  text: ${JSON.stringify(preview)}`);
      }
      if (block.children.length > 0) {
        console.log(`  children: [${block.children.join(", ")}]`);
      }
      if (Object.keys(block.props).length > 0) {
        for (const [k, v] of Object.entries(block.props)) {
          const val = typeof v === "string" && v.length > 150 ? v.slice(0, 150) + "..." : JSON.stringify(v);
          console.log(`  prop.${k}: ${val}`);
        }
      }
    }
  } finally {
    socket.disconnect();
  }
}

main().catch(console.error);
