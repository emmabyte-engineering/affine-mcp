import type { BlockInfo } from "../websocket.js";

export function renderBlocksToMarkdown(
  blocks: Map<string, BlockInfo>,
  rootIds: string[],
  depth = 0
): string {
  const lines: string[] = [];

  for (const id of rootIds) {
    const block = blocks.get(id);
    if (!block) continue;

    const line = renderBlock(block, depth);
    if (line !== null) {
      lines.push(line);
    }

    if (
      block.children.length > 0 &&
      block.flavour !== "affine:page" &&
      block.flavour !== "affine:surface"
    ) {
      const isListItem = block.flavour === "affine:list";
      const childDepth = isListItem ? depth + 1 : depth;
      const childMd = renderBlocksToMarkdown(blocks, block.children, childDepth);
      if (childMd) lines.push(childMd);
    } else if (
      block.flavour === "affine:page" ||
      block.flavour === "affine:note"
    ) {
      const childMd = renderBlocksToMarkdown(blocks, block.children, depth);
      if (childMd) lines.push(childMd);
    }
  }

  return lines.join("\n");
}

function renderBlock(block: BlockInfo, depth: number): string | null {
  const indent = "  ".repeat(depth);
  const text = block.text ?? "";

  switch (block.flavour) {
    case "affine:page":
    case "affine:note":
    case "affine:surface":
      return null;

    case "affine:paragraph": {
      switch (block.type) {
        case "h1":
          return `# ${text}`;
        case "h2":
          return `## ${text}`;
        case "h3":
          return `### ${text}`;
        case "h4":
          return `#### ${text}`;
        case "h5":
          return `##### ${text}`;
        case "h6":
          return `###### ${text}`;
        case "quote":
          return text
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
        default:
          return text;
      }
    }

    case "affine:list": {
      switch (block.type) {
        case "numbered":
          return `${indent}1. ${text}`;
        case "todo": {
          const checked = block.props.checked ? "x" : " ";
          return `${indent}- [${checked}] ${text}`;
        }
        case "toggle":
          return `${indent}- ${text}`;
        default:
          return `${indent}- ${text}`;
      }
    }

    case "affine:code": {
      const lang = (block.props.language as string) || "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }

    case "affine:divider":
      return "---";

    case "affine:image": {
      const src = (block.props.sourceId as string) || "";
      const caption = (block.props.caption as string) || "";
      return `![${caption}](${src})`;
    }

    case "affine:bookmark": {
      const url = (block.props.url as string) || "";
      const title = (block.props.title as string) || url;
      return `[${title}](${url})`;
    }

    case "affine:callout": {
      return `> ${text}`;
    }

    case "affine:latex": {
      const latex = (block.props.latex as string) || text;
      return `$$\n${latex}\n$$`;
    }

    case "affine:table": {
      return renderTable(block);
    }

    case "affine:embed-linked-doc": {
      const pageId = (block.props.pageId as string) || "";
      return `[linked-doc: ${pageId}]`;
    }

    default:
      if (text) return text;
      return null;
  }
}

interface TableCell {
  rowId: string;
  colId: string;
  text: string;
}

function renderTable(block: BlockInfo): string {
  const rows = block.props.rows as Record<string, { rowId: string; order: string }> | undefined;
  const columns = block.props.columns as Record<string, { columnId: string; order: string; width?: number }> | undefined;
  const cells = block.props.cells as Record<string, { text?: string }> | undefined;

  if (!rows || !columns || !cells) return "[table]";

  // Sort columns and rows by their fractional index order strings
  const sortedCols = Object.values(columns).sort((a, b) => a.order.localeCompare(b.order));
  const sortedRows = Object.values(rows).sort((a, b) => a.order.localeCompare(b.order));

  if (sortedCols.length === 0 || sortedRows.length === 0) return "[table]";

  // Build cell lookup
  const getCell = (rowId: string, colId: string): string => {
    const key = `${rowId}:${colId}`;
    const cell = cells[key];
    return cell?.text ?? "";
  };

  // Build markdown table
  const colIds = sortedCols.map((c) => c.columnId);
  const rowIds = sortedRows.map((r) => r.rowId);

  // First row is header
  const headerRow = rowIds[0];
  const headers = colIds.map((cid) => getCell(headerRow, cid));
  const separator = colIds.map((_, i) => "-".repeat(Math.max(3, headers[i].length)));
  const dataRows = rowIds.slice(1).map((rid) =>
    colIds.map((cid) => getCell(rid, cid))
  );

  const lines: string[] = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${separator.join(" | ")} |`);
  for (const row of dataRows) {
    lines.push(`| ${row.join(" | ")} |`);
  }

  return lines.join("\n");
}
