import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderBlocksToMarkdown } from "../../src/markdown/render.js";
import type { BlockInfo } from "../../src/websocket.js";

function makeBlocks(defs: BlockInfo[]): Map<string, BlockInfo> {
  const map = new Map<string, BlockInfo>();
  for (const d of defs) map.set(d.id, d);
  return map;
}

function block(overrides: Partial<BlockInfo> & { id: string }): BlockInfo {
  return {
    flavour: "affine:paragraph",
    type: "text",
    text: "",
    children: [],
    props: {},
    ...overrides,
  };
}

describe("renderBlocksToMarkdown", () => {
  it("renders paragraphs", () => {
    const blocks = makeBlocks([
      block({ id: "1", text: "Hello world" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "Hello world");
  });

  it("renders headings h1-h6", () => {
    const blocks = makeBlocks([
      block({ id: "1", type: "h1", text: "Title" }),
      block({ id: "2", type: "h2", text: "Sub" }),
      block({ id: "3", type: "h3", text: "SubSub" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1", "2", "3"]);
    assert.equal(md, "# Title\n## Sub\n### SubSub");
  });

  it("renders quotes", () => {
    const blocks = makeBlocks([
      block({ id: "1", type: "quote", text: "A quote" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "> A quote");
  });

  it("renders bulleted lists", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:list", type: "bulleted", text: "Item A" }),
      block({ id: "2", flavour: "affine:list", type: "bulleted", text: "Item B" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1", "2"]);
    assert.equal(md, "- Item A\n- Item B");
  });

  it("renders numbered lists", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:list", type: "numbered", text: "First" }),
      block({ id: "2", flavour: "affine:list", type: "numbered", text: "Second" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1", "2"]);
    assert.equal(md, "1. First\n1. Second");
  });

  it("renders todo lists", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:list", type: "todo", text: "Done", props: { checked: true } }),
      block({ id: "2", flavour: "affine:list", type: "todo", text: "Not done", props: { checked: false } }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1", "2"]);
    assert.equal(md, "- [x] Done\n- [ ] Not done");
  });

  it("renders code blocks with language", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:code", text: "console.log('hi');", props: { language: "javascript" } }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "```javascript\nconsole.log('hi');\n```");
  });

  it("renders dividers", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:divider", text: "" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "---");
  });

  it("renders images", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:image", props: { sourceId: "img123", caption: "A photo" } }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "![A photo](img123)");
  });

  it("renders bookmarks", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:bookmark", props: { url: "https://example.com", title: "Example" } }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "[Example](https://example.com)");
  });

  it("renders linked docs", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:embed-linked-doc", props: { pageId: "abc123" } }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "[linked-doc: abc123]");
  });

  it("renders nested list children with indentation", () => {
    const blocks = makeBlocks([
      block({ id: "1", flavour: "affine:list", type: "bulleted", text: "Parent", children: ["2"] }),
      block({ id: "2", flavour: "affine:list", type: "bulleted", text: "Child" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["1"]);
    assert.equal(md, "- Parent\n  - Child");
  });

  it("skips page, note, and surface blocks", () => {
    const blocks = makeBlocks([
      block({ id: "page", flavour: "affine:page", children: ["note"] }),
      block({ id: "note", flavour: "affine:note", children: ["1"] }),
      block({ id: "1", text: "Content" }),
    ]);
    const md = renderBlocksToMarkdown(blocks, ["page"]);
    assert.equal(md, "Content");
  });

  it("handles empty block list", () => {
    const blocks = makeBlocks([]);
    const md = renderBlocksToMarkdown(blocks, []);
    assert.equal(md, "");
  });
});
