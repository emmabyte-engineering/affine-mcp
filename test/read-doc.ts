import "dotenv/config";
import { loadConfig, detectServerVersion } from "../src/config.js";
import { signIn } from "../src/auth.js";
import { createSocket, setServerVersion } from "../src/websocket.js";
import { readDocContent } from "../src/doc-operations.js";

const docId = process.argv[2];
if (!docId) {
  console.error("Usage: npx tsx test/read-doc.ts <docId>");
  process.exit(1);
}

async function main() {
  const config = loadConfig();
  const version = await detectServerVersion(config);
  setServerVersion(version);
  const cookie = await signIn(config);

  const socket = createSocket(config, cookie);
  socket.connect();
  try {
    const result = await readDocContent(
      socket,
      "98e629ce-f10b-4389-9eab-370eaff83026",
      docId
    );
    console.log(`# ${result.title}\n`);
    console.log(result.markdown);
  } finally {
    socket.disconnect();
  }
}

main().catch(console.error);
