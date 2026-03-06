import { io, Socket } from "socket.io-client";
import * as Y from "yjs";
import type { AffineConfig } from "./config.js";
import { getAuthHeaders } from "./auth.js";

const TIMEOUT = 15_000;

function getWsUrl(config: AffineConfig): string {
  return config.baseUrl
    .replace("https://", "wss://")
    .replace("http://", "ws://");
}

export function createSocket(config: AffineConfig, cookie?: string): Socket {
  const url = getWsUrl(config);
  const authHeaders = getAuthHeaders(config, cookie);

  return io(url, {
    transports: ["websocket"],
    path: "/socket.io/",
    autoConnect: false,
    extraHeaders: authHeaders,
  });
}

function emitWithAck(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${event}`)),
      TIMEOUT
    );
    socket.emit(event, payload, (res: any) => {
      clearTimeout(timer);
      if (res?.error) {
        reject(new Error(`${event} error: ${JSON.stringify(res.error)}`));
      } else {
        resolve(res);
      }
    });
  });
}

let _serverVersion = "0.26.0";

export function setServerVersion(version: string) {
  _serverVersion = version;
}

export async function joinWorkspace(
  socket: Socket,
  workspaceId: string
): Promise<void> {
  const res = await emitWithAck(socket, "space:join", {
    spaceType: "workspace",
    spaceId: workspaceId,
    clientVersion: _serverVersion,
  });
  if (res?.data?.success === false) {
    throw new Error(`Failed to join workspace ${workspaceId} (clientVersion: ${_serverVersion})`);
  }
}

export async function loadDoc(
  socket: Socket,
  workspaceId: string,
  docId: string
): Promise<Y.Doc> {
  const res = await emitWithAck(socket, "space:load-doc", {
    spaceType: "workspace",
    spaceId: workspaceId,
    docId,
  });

  const doc = new Y.Doc();
  if (res?.data?.missing) {
    const data =
      typeof res.data.missing === "string"
        ? Buffer.from(res.data.missing, "base64")
        : new Uint8Array(res.data.missing);
    Y.applyUpdate(doc, data);
  } else if (res?.missing) {
    const data =
      typeof res.missing === "string"
        ? Buffer.from(res.missing, "base64")
        : new Uint8Array(res.missing);
    Y.applyUpdate(doc, data);
  }
  return doc;
}

export async function pushDocUpdate(
  socket: Socket,
  workspaceId: string,
  docId: string,
  update: Uint8Array
): Promise<void> {
  await emitWithAck(socket, "space:push-doc-update", {
    spaceType: "workspace",
    spaceId: workspaceId,
    docId,
    update: Buffer.from(update).toString("base64"),
  });
}

export async function deleteDoc(
  socket: Socket,
  workspaceId: string,
  docId: string
): Promise<void> {
  socket.emit("space:delete-doc", {
    spaceType: "workspace",
    spaceId: workspaceId,
    docId,
  });
}

export interface BlockInfo {
  id: string;
  flavour: string;
  type?: string;
  text?: string;
  children: string[];
  parentId?: string;
  props: Record<string, unknown>;
}

export function extractBlocks(doc: Y.Doc): Map<string, BlockInfo> {
  const blocksMap = doc.getMap("blocks");
  const blocks = new Map<string, BlockInfo>();

  blocksMap.forEach((value, key) => {
    if (!(value instanceof Y.Map)) return;
    const block = value as Y.Map<any>;

    const id = (block.get("sys:id") as string) || key;
    const flavour = (block.get("sys:flavour") as string) || "";
    const typeVal = block.get("prop:type") as string | undefined;

    let text: string | undefined;
    const propText = block.get("prop:text");
    if (propText instanceof Y.Text) {
      text = propText.toString();
    } else if (typeof propText === "string") {
      text = propText;
    }

    const childrenArr = block.get("sys:children");
    const children: string[] = [];
    if (childrenArr instanceof Y.Array) {
      childrenArr.forEach((c: any) => {
        if (typeof c === "string") children.push(c);
      });
    }

    const props: Record<string, unknown> = {};
    block.forEach((v: any, k: string) => {
      if (k.startsWith("prop:") && k !== "prop:text" && k !== "prop:type") {
        if (v instanceof Y.Text) {
          props[k.slice(5)] = v.toString();
        } else if (v instanceof Y.Array) {
          props[k.slice(5)] = v.toJSON();
        } else if (v instanceof Y.Map) {
          props[k.slice(5)] = v.toJSON();
        } else {
          props[k.slice(5)] = v;
        }
      }
    });

    blocks.set(id, { id, flavour, type: typeVal, text, children, props });
  });

  return blocks;
}

export function findRootBlock(blocks: Map<string, BlockInfo>): BlockInfo | undefined {
  return Array.from(blocks.values()).find((b) => b.flavour === "affine:page");
}

export function findNoteBlock(blocks: Map<string, BlockInfo>): BlockInfo | undefined {
  return Array.from(blocks.values()).find((b) => b.flavour === "affine:note");
}

export function getDocTitle(doc: Y.Doc): string {
  const blocksMap = doc.getMap("blocks");
  for (const [, value] of blocksMap) {
    if (!(value instanceof Y.Map)) continue;
    const block = value as Y.Map<any>;
    if (block.get("sys:flavour") === "affine:page") {
      const title = block.get("prop:title");
      if (title instanceof Y.Text) return title.toString();
      if (typeof title === "string") return title;
    }
  }
  return "";
}
