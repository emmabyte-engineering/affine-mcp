import * as Y from "yjs";
import type { Socket } from "socket.io-client";
import {
  loadDoc,
  pushDocUpdate,
  extractBlocks,
  findNoteBlock,
  findRootBlock,
  joinWorkspace,
  getDocTitle,
  deleteDoc as wsDeleteDoc,
  type BlockInfo,
} from "./websocket.js";
import { renderBlocksToMarkdown } from "./markdown/render.js";
import { parseMarkdown, type MarkdownBlock } from "./markdown/parse.js";
import { GraphQLClient, GET_COMMENTS } from "./graphql.js";

function randomId(len = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < len; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// --- Read ---

export async function readDocContent(
  socket: Socket,
  workspaceId: string,
  docId: string
): Promise<{ title: string; markdown: string; plainText: string }> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const title = getDocTitle(doc);
  const blocks = extractBlocks(doc);
  const root = findRootBlock(blocks);

  let markdown = "";
  let plainText = "";

  if (root) {
    markdown = renderBlocksToMarkdown(blocks, root.children);

    const texts: string[] = [];
    for (const [, block] of blocks) {
      if (block.text) texts.push(block.text);
    }
    plainText = texts.join("\n");
  }

  return { title, markdown, plainText };
}

// --- Bulk Read ---

export async function readMultipleDocs(
  socket: Socket,
  workspaceId: string,
  docIds: string[]
): Promise<Array<{ docId: string; title: string; markdown: string; error?: string }>> {
  await joinWorkspace(socket, workspaceId);
  const results: Array<{ docId: string; title: string; markdown: string; error?: string }> = [];

  for (const docId of docIds) {
    try {
      const doc = await loadDoc(socket, workspaceId, docId);
      const title = getDocTitle(doc);
      const blocks = extractBlocks(doc);
      const root = findRootBlock(blocks);
      const markdown = root ? renderBlocksToMarkdown(blocks, root.children) : "";
      results.push({ docId, title, markdown });
    } catch (err: any) {
      results.push({ docId, title: "", markdown: "", error: err.message });
    }
  }

  return results;
}

// --- Create ---

export async function createDocument(
  socket: Socket,
  workspaceId: string,
  title: string,
  markdownContent?: string
): Promise<string> {
  await joinWorkspace(socket, workspaceId);

  const docId = randomId();
  const doc = new Y.Doc();
  const blocksMap = doc.getMap("blocks");

  const pageId = randomId();
  const surfaceId = randomId();
  const noteId = randomId();

  doc.transact(() => {
    const pageBlock = new Y.Map();
    pageBlock.set("sys:id", pageId);
    pageBlock.set("sys:flavour", "affine:page");
    pageBlock.set("sys:version", 2);

    const titleText = new Y.Text();
    titleText.insert(0, title);
    pageBlock.set("prop:title", titleText);

    const pageChildren = new Y.Array();
    pageChildren.push([surfaceId, noteId]);
    pageBlock.set("sys:children", pageChildren);
    blocksMap.set(pageId, pageBlock);

    const surfaceBlock = new Y.Map();
    surfaceBlock.set("sys:id", surfaceId);
    surfaceBlock.set("sys:flavour", "affine:surface");
    surfaceBlock.set("sys:version", 5);
    surfaceBlock.set("sys:children", new Y.Array());
    blocksMap.set(surfaceId, surfaceBlock);

    const noteBlock = new Y.Map();
    noteBlock.set("sys:id", noteId);
    noteBlock.set("sys:flavour", "affine:note");
    noteBlock.set("sys:version", 1);
    const noteChildren = new Y.Array();
    noteBlock.set("sys:children", noteChildren);
    blocksMap.set(noteId, noteBlock);

    if (markdownContent) {
      const parsed = parseMarkdown(markdownContent);
      for (const mb of parsed) {
        const blockId = randomId();
        const block = createBlockFromMarkdown(mb, blockId);
        blocksMap.set(blockId, block);
        noteChildren.push([blockId]);
      }
    }
  });

  const update = Y.encodeStateAsUpdate(doc);
  await pushDocUpdate(socket, workspaceId, docId, update);
  await registerDocInWorkspace(socket, workspaceId, docId, title);

  return docId;
}

function createBlockFromMarkdown(mb: MarkdownBlock, blockId: string): Y.Map<any> {
  const block = new Y.Map();
  block.set("sys:id", blockId);
  block.set("sys:version", 1);
  block.set("sys:children", new Y.Array());

  switch (mb.type) {
    case "heading":
      block.set("sys:flavour", "affine:paragraph");
      block.set("prop:type", `h${mb.level || 1}`);
      break;
    case "paragraph":
      block.set("sys:flavour", "affine:paragraph");
      block.set("prop:type", "text");
      break;
    case "quote":
      block.set("sys:flavour", "affine:paragraph");
      block.set("prop:type", "quote");
      break;
    case "bulleted_list":
      block.set("sys:flavour", "affine:list");
      block.set("prop:type", "bulleted");
      break;
    case "numbered_list":
      block.set("sys:flavour", "affine:list");
      block.set("prop:type", "numbered");
      break;
    case "todo_list":
      block.set("sys:flavour", "affine:list");
      block.set("prop:type", "todo");
      block.set("prop:checked", mb.checked ?? false);
      break;
    case "code":
      block.set("sys:flavour", "affine:code");
      if (mb.language) block.set("prop:language", mb.language);
      break;
    case "divider":
      block.set("sys:flavour", "affine:divider");
      return block;
  }

  const text = new Y.Text();
  text.insert(0, mb.text);
  block.set("prop:text", text);

  return block;
}

async function registerDocInWorkspace(
  socket: Socket,
  workspaceId: string,
  docId: string,
  title: string
): Promise<void> {
  try {
    const wsDoc = await loadDoc(socket, workspaceId, workspaceId);
    const prevSV = Y.encodeStateVector(wsDoc);

    wsDoc.transact(() => {
      const meta = wsDoc.getMap("meta");
      let pages = meta.get("pages") as Y.Array<Y.Map<any>> | undefined;
      if (!pages) {
        pages = new Y.Array();
        meta.set("pages", pages);
      }

      const pageEntry = new Y.Map();
      pageEntry.set("id", docId);
      pageEntry.set("title", title);
      pageEntry.set("createDate", Date.now());
      pages.push([pageEntry]);
    });

    const update = Y.encodeStateAsUpdate(wsDoc, prevSV);
    await pushDocUpdate(socket, workspaceId, workspaceId, update);
  } catch {
    // Non-critical
  }
}

// --- Append ---

export async function appendMarkdownToDoc(
  socket: Socket,
  workspaceId: string,
  docId: string,
  markdown: string
): Promise<void> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const prevSV = Y.encodeStateVector(doc);
  const blocksMap = doc.getMap("blocks");
  const blocks = extractBlocks(doc);
  const note = findNoteBlock(blocks);

  if (!note) throw new Error("No note block found in document");

  const noteYMap = blocksMap.get(note.id) as Y.Map<any>;
  const noteChildren = noteYMap.get("sys:children") as Y.Array<string>;

  const parsed = parseMarkdown(markdown);

  doc.transact(() => {
    for (const mb of parsed) {
      const blockId = randomId();
      const block = createBlockFromMarkdown(mb, blockId);
      blocksMap.set(blockId, block);
      noteChildren.push([blockId]);
    }
  });

  const update = Y.encodeStateAsUpdate(doc, prevSV);
  await pushDocUpdate(socket, workspaceId, docId, update);
}

// --- Replace ---

export async function replaceDocContent(
  socket: Socket,
  workspaceId: string,
  docId: string,
  markdown: string,
  newTitle?: string
): Promise<void> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const prevSV = Y.encodeStateVector(doc);
  const blocksMap = doc.getMap("blocks");
  const blocks = extractBlocks(doc);
  const note = findNoteBlock(blocks);

  if (!note) throw new Error("No note block found in document");

  const noteYMap = blocksMap.get(note.id) as Y.Map<any>;
  const noteChildren = noteYMap.get("sys:children") as Y.Array<string>;

  doc.transact(() => {
    if (newTitle) {
      const root = findRootBlock(blocks);
      if (root) {
        const pageYMap = blocksMap.get(root.id) as Y.Map<any>;
        const titleText = pageYMap.get("prop:title") as Y.Text;
        if (titleText instanceof Y.Text) {
          titleText.delete(0, titleText.length);
          titleText.insert(0, newTitle);
        }
      }
    }

    const toRemove = new Set<string>();
    const collectChildren = (ids: string[]) => {
      for (const id of ids) {
        toRemove.add(id);
        const b = blocks.get(id);
        if (b) collectChildren(b.children);
      }
    };
    collectChildren(note.children);

    for (const id of toRemove) {
      blocksMap.delete(id);
    }

    while (noteChildren.length > 0) {
      noteChildren.delete(0);
    }

    const parsed = parseMarkdown(markdown);
    for (const mb of parsed) {
      const blockId = randomId();
      const block = createBlockFromMarkdown(mb, blockId);
      blocksMap.set(blockId, block);
      noteChildren.push([blockId]);
    }
  });

  const update = Y.encodeStateAsUpdate(doc, prevSV);
  await pushDocUpdate(socket, workspaceId, docId, update);
}

// --- Delete ---

export async function removeDoc(
  socket: Socket,
  workspaceId: string,
  docId: string
): Promise<void> {
  await joinWorkspace(socket, workspaceId);
  await wsDeleteDoc(socket, workspaceId, docId);

  try {
    const wsDoc = await loadDoc(socket, workspaceId, workspaceId);
    const prevSV = Y.encodeStateVector(wsDoc);

    wsDoc.transact(() => {
      const meta = wsDoc.getMap("meta");
      const pages = meta.get("pages") as Y.Array<Y.Map<any>> | undefined;
      if (pages) {
        for (let i = 0; i < pages.length; i++) {
          const page = pages.get(i);
          if (page instanceof Y.Map && page.get("id") === docId) {
            pages.delete(i);
            break;
          }
        }
      }
    });

    const update = Y.encodeStateAsUpdate(wsDoc, prevSV);
    await pushDocUpdate(socket, workspaceId, workspaceId, update);
  } catch {
    // Non-critical
  }
}

// --- Search ---

export async function searchDocs(
  socket: Socket,
  workspaceId: string,
  query: string,
  docIds: string[]
): Promise<Array<{ docId: string; title: string; snippet: string }>> {
  await joinWorkspace(socket, workspaceId);
  const results: Array<{ docId: string; title: string; snippet: string }> = [];
  const lowerQuery = query.toLowerCase();

  for (const docId of docIds) {
    try {
      const doc = await loadDoc(socket, workspaceId, docId);
      const title = getDocTitle(doc);
      const blocks = extractBlocks(doc);

      const texts: string[] = [];
      for (const [, block] of blocks) {
        if (block.text) texts.push(block.text);
      }
      const fullText = texts.join("\n");
      const lowerText = (title + "\n" + fullText).toLowerCase();

      if (lowerText.includes(lowerQuery)) {
        const matchIndex = lowerText.indexOf(lowerQuery);
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(lowerText.length, matchIndex + query.length + 50);
        const snippet = (title + "\n" + fullText).slice(start, end);

        results.push({ docId, title, snippet: snippet.trim() });
      }
    } catch {
      // Skip docs that can't be loaded
    }
  }

  return results;
}

// --- Mermaid ---

export interface MermaidDiagram {
  blockId: string;
  code: string;
  caption?: string;
}

export async function getMermaidDiagrams(
  socket: Socket,
  workspaceId: string,
  docId: string
): Promise<{ title: string; diagrams: MermaidDiagram[] }> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const title = getDocTitle(doc);
  const blocks = extractBlocks(doc);
  const diagrams: MermaidDiagram[] = [];

  for (const [, block] of blocks) {
    if (block.flavour === "affine:code" && block.props.language === "mermaid") {
      diagrams.push({
        blockId: block.id,
        code: block.text || "",
        caption: (block.props.caption as string) || undefined,
      });
    }
  }

  return { title, diagrams };
}

export async function updateMermaidDiagram(
  socket: Socket,
  workspaceId: string,
  docId: string,
  blockId: string,
  newCode: string
): Promise<void> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const prevSV = Y.encodeStateVector(doc);
  const blocksMap = doc.getMap("blocks");

  const blockYMap = blocksMap.get(blockId) as Y.Map<any> | undefined;
  if (!blockYMap) throw new Error(`Block ${blockId} not found`);

  const flavour = blockYMap.get("sys:flavour");
  const lang = blockYMap.get("prop:language");
  if (flavour !== "affine:code" || lang !== "mermaid") {
    throw new Error(`Block ${blockId} is not a mermaid code block`);
  }

  doc.transact(() => {
    const textY = blockYMap.get("prop:text");
    if (textY instanceof Y.Text) {
      textY.delete(0, textY.length);
      textY.insert(0, newCode);
    }
  });

  const update = Y.encodeStateAsUpdate(doc, prevSV);
  await pushDocUpdate(socket, workspaceId, docId, update);
}

export async function insertMermaidDiagram(
  socket: Socket,
  workspaceId: string,
  docId: string,
  mermaidCode: string
): Promise<string> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const prevSV = Y.encodeStateVector(doc);
  const blocksMap = doc.getMap("blocks");
  const blocks = extractBlocks(doc);
  const note = findNoteBlock(blocks);

  if (!note) throw new Error("No note block found in document");

  const noteYMap = blocksMap.get(note.id) as Y.Map<any>;
  const noteChildren = noteYMap.get("sys:children") as Y.Array<string>;

  const blockId = randomId();

  doc.transact(() => {
    const block = new Y.Map();
    block.set("sys:id", blockId);
    block.set("sys:flavour", "affine:code");
    block.set("sys:version", 1);
    block.set("sys:children", new Y.Array());
    block.set("prop:language", "mermaid");
    block.set("prop:wrap", false);
    block.set("prop:caption", "");

    const text = new Y.Text();
    text.insert(0, mermaidCode);
    block.set("prop:text", text);

    blocksMap.set(blockId, block);
    noteChildren.push([blockId]);
  });

  const update = Y.encodeStateAsUpdate(doc, prevSV);
  await pushDocUpdate(socket, workspaceId, docId, update);

  return blockId;
}

// --- Doc Link Graph ---

export interface DocLink {
  sourceDocId: string;
  sourceDocTitle: string;
  targetDocId: string;
  blockId: string;
}

export async function getDocLinks(
  socket: Socket,
  workspaceId: string,
  docIds: string[]
): Promise<DocLink[]> {
  await joinWorkspace(socket, workspaceId);
  const links: DocLink[] = [];

  for (const docId of docIds) {
    try {
      const doc = await loadDoc(socket, workspaceId, docId);
      const title = getDocTitle(doc);
      const blocks = extractBlocks(doc);

      for (const [, block] of blocks) {
        if (block.flavour === "affine:embed-linked-doc") {
          const targetId = block.props.pageId as string;
          if (targetId) {
            links.push({
              sourceDocId: docId,
              sourceDocTitle: title,
              targetDocId: targetId,
              blockId: block.id,
            });
          }
        }
      }
    } catch {
      // Skip unreadable docs
    }
  }

  return links;
}

// --- Table Operations ---

export interface TableData {
  blockId: string;
  headers: string[];
  rows: string[][];
}

export async function getDocTables(
  socket: Socket,
  workspaceId: string,
  docId: string
): Promise<{ title: string; tables: TableData[] }> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const title = getDocTitle(doc);
  const blocks = extractBlocks(doc);
  const tables: TableData[] = [];

  for (const [, block] of blocks) {
    if (block.flavour === "affine:table") {
      const parsed = parseTableBlock(block);
      if (parsed) tables.push(parsed);
    }
  }

  return { title, tables };
}

function parseTableBlock(block: BlockInfo): TableData | null {
  const rows = block.props.rows as Record<string, { rowId: string; order: string }> | undefined;
  const columns = block.props.columns as Record<string, { columnId: string; order: string }> | undefined;
  const cells = block.props.cells as Record<string, { text?: string }> | undefined;

  if (!rows || !columns || !cells) return null;

  const sortedCols = Object.values(columns).sort((a, b) => a.order.localeCompare(b.order));
  const sortedRows = Object.values(rows).sort((a, b) => a.order.localeCompare(b.order));

  if (sortedCols.length === 0 || sortedRows.length === 0) return null;

  const colIds = sortedCols.map((c) => c.columnId);
  const rowIds = sortedRows.map((r) => r.rowId);

  const getCell = (rowId: string, colId: string): string => {
    return cells[`${rowId}:${colId}`]?.text ?? "";
  };

  // First row = headers
  const headers = colIds.map((cid) => getCell(rowIds[0], cid));
  const dataRows = rowIds.slice(1).map((rid) =>
    colIds.map((cid) => getCell(rid, cid))
  );

  return { blockId: block.id, headers, rows: dataRows };
}

function fractionalOrder(index: number): string {
  // Generate simple fractional index strings for ordering
  const hex = index.toString(16).padStart(2, "0");
  return `a${hex}${randomId(20)}`;
}

export async function insertTable(
  socket: Socket,
  workspaceId: string,
  docId: string,
  headers: string[],
  rows: string[][]
): Promise<string> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const prevSV = Y.encodeStateVector(doc);
  const blocksMap = doc.getMap("blocks");
  const blocks = extractBlocks(doc);
  const note = findNoteBlock(blocks);

  if (!note) throw new Error("No note block found in document");

  const noteYMap = blocksMap.get(note.id) as Y.Map<any>;
  const noteChildren = noteYMap.get("sys:children") as Y.Array<string>;

  const blockId = randomId();
  const allRows = [headers, ...rows];

  doc.transact(() => {
    const block = new Y.Map();
    block.set("sys:id", blockId);
    block.set("sys:flavour", "affine:table");
    block.set("sys:version", 1);
    block.set("sys:children", new Y.Array());

    // Generate column IDs
    const colDefs: Array<{ columnId: string; order: string }> = [];
    for (let c = 0; c < headers.length; c++) {
      colDefs.push({ columnId: randomId(), order: fractionalOrder(c) });
    }

    // Generate row IDs
    const rowDefs: Array<{ rowId: string; order: string }> = [];
    for (let r = 0; r < allRows.length; r++) {
      rowDefs.push({ rowId: randomId(), order: fractionalOrder(r) });
    }

    // Build rows map
    const rowsMap = new Y.Map();
    for (const rd of rowDefs) {
      const rm = new Y.Map();
      rm.set("rowId", rd.rowId);
      rm.set("order", rd.order);
      rowsMap.set(rd.rowId, rm);
    }
    block.set("prop:rows", rowsMap);

    // Build columns map
    const colsMap = new Y.Map();
    for (const cd of colDefs) {
      const cm = new Y.Map();
      cm.set("columnId", cd.columnId);
      cm.set("order", cd.order);
      colsMap.set(cd.columnId, cm);
    }
    block.set("prop:columns", colsMap);

    // Build cells map
    const cellsMap = new Y.Map();
    for (let r = 0; r < allRows.length; r++) {
      for (let c = 0; c < colDefs.length; c++) {
        const value = allRows[r][c] ?? "";
        const key = `${rowDefs[r].rowId}:${colDefs[c].columnId}`;
        const cellMap = new Y.Map();
        const cellText = new Y.Text();
        cellText.insert(0, value);
        cellMap.set("text", cellText);
        cellsMap.set(key, cellMap);
      }
    }
    block.set("prop:cells", cellsMap);

    blocksMap.set(blockId, block);
    noteChildren.push([blockId]);
  });

  const update = Y.encodeStateAsUpdate(doc, prevSV);
  await pushDocUpdate(socket, workspaceId, docId, update);

  return blockId;
}

export async function updateTable(
  socket: Socket,
  workspaceId: string,
  docId: string,
  blockId: string,
  headers: string[],
  rows: string[][]
): Promise<void> {
  await joinWorkspace(socket, workspaceId);
  const doc = await loadDoc(socket, workspaceId, docId);
  const prevSV = Y.encodeStateVector(doc);
  const blocksMap = doc.getMap("blocks");

  const blockYMap = blocksMap.get(blockId) as Y.Map<any> | undefined;
  if (!blockYMap) throw new Error(`Block ${blockId} not found`);
  if (blockYMap.get("sys:flavour") !== "affine:table") {
    throw new Error(`Block ${blockId} is not a table`);
  }

  const allRows = [headers, ...rows];

  doc.transact(() => {
    // Generate new column/row IDs
    const colDefs: Array<{ columnId: string; order: string }> = [];
    for (let c = 0; c < headers.length; c++) {
      colDefs.push({ columnId: randomId(), order: fractionalOrder(c) });
    }
    const rowDefs: Array<{ rowId: string; order: string }> = [];
    for (let r = 0; r < allRows.length; r++) {
      rowDefs.push({ rowId: randomId(), order: fractionalOrder(r) });
    }

    // Replace rows
    const rowsMap = new Y.Map();
    for (const rd of rowDefs) {
      const rm = new Y.Map();
      rm.set("rowId", rd.rowId);
      rm.set("order", rd.order);
      rowsMap.set(rd.rowId, rm);
    }
    blockYMap.set("prop:rows", rowsMap);

    // Replace columns
    const colsMap = new Y.Map();
    for (const cd of colDefs) {
      const cm = new Y.Map();
      cm.set("columnId", cd.columnId);
      cm.set("order", cd.order);
      colsMap.set(cd.columnId, cm);
    }
    blockYMap.set("prop:columns", colsMap);

    // Replace cells
    const cellsMap = new Y.Map();
    for (let r = 0; r < allRows.length; r++) {
      for (let c = 0; c < colDefs.length; c++) {
        const value = allRows[r][c] ?? "";
        const key = `${rowDefs[r].rowId}:${colDefs[c].columnId}`;
        const cellMap = new Y.Map();
        const cellText = new Y.Text();
        cellText.insert(0, value);
        cellMap.set("text", cellText);
        cellsMap.set(key, cellMap);
      }
    }
    blockYMap.set("prop:cells", cellsMap);
  });

  const update = Y.encodeStateAsUpdate(doc, prevSV);
  await pushDocUpdate(socket, workspaceId, docId, update);
}

// --- Comments ---

export interface CommentInfo {
  commentId: string;
  author: string;
  content: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  anchorText?: string;
  blockText?: string;
  replies: Array<{
    replyId: string;
    author: string;
    content: string;
    createdAt: string;
  }>;
}

/** Extract plain text from a BlockSuite comment content snapshot. */
function extractCommentText(content: any): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";

  try {
    const blocks = content.snapshot?.blocks;
    if (!blocks) return content.preview || "";
    return extractTextFromBlock(blocks);
  } catch {
    return content.preview || "";
  }
}

function extractTextFromBlock(block: any): string {
  const parts: string[] = [];

  const delta = block.props?.text?.delta;
  if (Array.isArray(delta)) {
    for (const op of delta) {
      if (typeof op.insert === "string") {
        parts.push(op.insert);
      }
    }
  }

  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      const childText = extractTextFromBlock(child);
      if (childText) parts.push(childText);
    }
  }

  return parts.join("");
}

/** Find inline comment anchors in a Yjs doc. Returns a map from comment UUID to the highlighted text and surrounding block text. */
function findCommentAnchors(
  doc: Y.Doc
): Map<string, { anchorText: string; blockText: string }> {
  const anchors = new Map<string, { anchorText: string; blockText: string }>();
  const blocksMap = doc.getMap("blocks");

  blocksMap.forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const block = value as Y.Map<any>;
    const propText = block.get("prop:text");
    if (!(propText instanceof Y.Text)) return;

    const delta = propText.toDelta();
    for (const op of delta) {
      if (!op.attributes) continue;
      for (const key of Object.keys(op.attributes)) {
        if (key.startsWith("comment-")) {
          const commentId = key.slice(8);
          const anchorText =
            typeof op.insert === "string" ? op.insert : "";
          anchors.set(commentId, {
            anchorText,
            blockText: propText.toString(),
          });
        }
      }
    }
  });

  return anchors;
}

export async function getDocComments(
  gql: GraphQLClient,
  socket: Socket,
  workspaceId: string,
  docId: string
): Promise<{ title: string; comments: CommentInfo[] }> {
  await joinWorkspace(socket, workspaceId);

  const [commentsData, doc] = await Promise.all([
    fetchAllComments(gql, workspaceId, docId),
    loadDoc(socket, workspaceId, docId),
  ]);

  const title = getDocTitle(doc);
  const anchors = findCommentAnchors(doc);

  const comments: CommentInfo[] = commentsData.map((raw) => {
    const anchor = anchors.get(raw.id);
    return {
      commentId: raw.id,
      author: raw.user?.name || "Unknown",
      content: extractCommentText(raw.content),
      resolved: raw.resolved,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      anchorText: anchor?.anchorText,
      blockText: anchor?.blockText,
      replies: (raw.replies || []).map((r: any) => ({
        replyId: r.id,
        author: r.user?.name || "Unknown",
        content: extractCommentText(r.content),
        createdAt: r.createdAt,
      })),
    };
  });

  return { title, comments };
}

async function fetchAllComments(
  gql: GraphQLClient,
  workspaceId: string,
  docId: string
): Promise<any[]> {
  const all: any[] = [];
  let hasMore = true;
  let cursor: string | undefined;

  while (hasMore) {
    const vars: Record<string, unknown> = { workspaceId, docId, first: 50 };
    if (cursor) vars.after = cursor;

    const data = await gql.query<{ workspace: { comments: any } }>(
      GET_COMMENTS,
      vars
    );
    const comments = data.workspace.comments;
    for (const edge of comments.edges) {
      all.push(edge.node);
    }
    hasMore = comments.pageInfo.hasNextPage;
    cursor = comments.pageInfo.endCursor;
  }

  return all;
}
