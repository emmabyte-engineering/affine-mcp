import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../../src/markdown/parse.js";
import { renderBlocksToMarkdown } from "../../src/markdown/render.js";
import type { BlockInfo } from "../../src/websocket.js";

function roundtrip(markdown: string): string {
  const parsed = parseMarkdown(markdown);
  const blocks = new Map<string, BlockInfo>();

  for (let i = 0; i < parsed.length; i++) {
    const mb = parsed[i];
    const id = `block-${i}`;
    let flavour: string;
    let type: string | undefined;
    const props: Record<string, unknown> = {};

    switch (mb.type) {
      case "heading":
        flavour = "affine:paragraph";
        type = `h${mb.level || 1}`;
        break;
      case "paragraph":
        flavour = "affine:paragraph";
        type = "text";
        break;
      case "quote":
        flavour = "affine:paragraph";
        type = "quote";
        break;
      case "bulleted_list":
        flavour = "affine:list";
        type = "bulleted";
        break;
      case "numbered_list":
        flavour = "affine:list";
        type = "numbered";
        break;
      case "todo_list":
        flavour = "affine:list";
        type = "todo";
        props.checked = mb.checked ?? false;
        break;
      case "code":
        flavour = "affine:code";
        if (mb.language) props.language = mb.language;
        break;
      case "divider":
        flavour = "affine:divider";
        break;
      default:
        flavour = "affine:paragraph";
        type = "text";
    }

    blocks.set(id, { id, flavour, type, text: mb.text, children: [], props });
  }

  const rootIds = Array.from(blocks.keys());
  return renderBlocksToMarkdown(blocks, rootIds);
}

describe("markdown round-trip", () => {
  it("preserves headings", () => {
    const md = "# Title\n## Subtitle";
    assert.equal(roundtrip(md), md);
  });

  it("preserves paragraphs", () => {
    const md = "Hello world";
    assert.equal(roundtrip(md), md);
  });

  it("preserves bulleted lists", () => {
    const md = "- A\n- B\n- C";
    assert.equal(roundtrip(md), md);
  });

  it("preserves code blocks with language", () => {
    const md = "```python\nprint('hi')\n```";
    assert.equal(roundtrip(md), md);
  });

  it("preserves blockquotes", () => {
    const md = "> A quote";
    assert.equal(roundtrip(md), md);
  });

  it("preserves dividers", () => {
    const md = "---";
    assert.equal(roundtrip(md), md);
  });

  it("preserves todo lists", () => {
    const md = "- [ ] Unchecked\n- [x] Checked";
    assert.equal(roundtrip(md), md);
  });

  it("preserves mixed content document", () => {
    const md = [
      "# Document Title",
      "Some introductory text.",
      "## Section",
      "- Bullet one",
      "- Bullet two",
      "> A blockquote",
      "---",
      "```javascript\nconsole.log('done');\n```",
    ].join("\n");
    assert.equal(roundtrip(md), md);
  });
});
