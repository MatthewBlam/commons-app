import { Client, isFullPage, isFullDatabase, LogLevel } from "@notionhq/client";
import type { BlockObjectResponse, PageObjectResponse, RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints";
import type { Connector, RawDocument } from "../sync/sync-manager";
import type { NotionItemSummary } from "../../shared/types";

const MAX_DEPTH = 10;
const MAX_BLOCK_DEPTH = 20;
const DEFAULT_THROTTLE_MS = 334;

export class NotionConnector implements Connector {
  private client: Client;
  private rootPageId: string;
  private lastRequestTime = 0;
  private throttleMs: number;

  constructor(token: string, rootPageId: string, throttleMs = DEFAULT_THROTTLE_MS) {
    this.client = new Client({ auth: token, logLevel: LogLevel.ERROR });
    this.rootPageId = rootPageId;
    this.throttleMs = throttleMs;
  }

  async *fetchDocuments(): AsyncGenerator<RawDocument> {
    yield* this.walkPage(this.rootPageId, 0);
  }

  private async *walkPage(pageId: string, depth: number): AsyncGenerator<RawDocument> {
    if (depth > MAX_DEPTH) return;

    const page = (await this.rateLimited(() => this.client.pages.retrieve({ page_id: pageId }))) as PageObjectResponse;

    const title = extractPageTitle(page);
    const url = page.url ?? null;
    const blocks = await this.fetchAllBlocks(pageId);
    const content = blocksToText(blocks);

    if (content.trim()) {
      yield {
        externalId: pageId,
        title,
        url,
        mimeType: "text/plain",
        modifiedAt: page.last_edited_time ?? null,
        content,
      };
    }

    for (const block of blocks) {
      if (block.type === "child_page") {
        yield* this.walkPage(block.id, depth + 1);
      }
      if (block.type === "child_database") {
        try {
          yield* this.walkDatabase(block.id, depth + 1);
        } catch (err) {
          const status = err instanceof Object && "status" in err ? (err as { status: number }).status : 0;
          if (status === 403 || status === 404) {
            console.warn(`Skipping database ${block.id}: ${status} (not shared or not found)`);
            continue;
          }
          throw err;
        }
      }
    }
  }

  private async *walkDatabase(databaseId: string, depth: number): AsyncGenerator<RawDocument> {
    if (depth > MAX_DEPTH) return;

    const dataSourceId = await this.resolveDataSourceId(databaseId);

    let cursor: string | undefined;
    do {
      const response = await this.rateLimited(() =>
        this.client.dataSources.query({
          data_source_id: dataSourceId,
          start_cursor: cursor,
          page_size: 100,
        }),
      );

      for (const result of response.results) {
        if ("url" in result) {
          yield* this.walkPage(result.id, depth + 1);
        }
      }

      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    } while (cursor);
  }

  private async resolveDataSourceId(databaseId: string): Promise<string> {
    const db = await this.rateLimited(() => this.client.databases.retrieve({ database_id: databaseId }));
    if (isFullDatabase(db) && db.data_sources.length > 0) {
      return db.data_sources[0].id;
    }
    return databaseId;
  }

  private async fetchAllBlocks(blockId: string, depth = 0): Promise<BlockObjectResponse[]> {
    if (depth >= MAX_BLOCK_DEPTH) return [];
    const blocks: BlockObjectResponse[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.rateLimited(() =>
        this.client.blocks.children.list({
          block_id: blockId,
          start_cursor: cursor,
          page_size: 100,
        }),
      );
      for (const result of response.results) {
        if ("type" in result) {
          const block = result as BlockObjectResponse;
          blocks.push(block);
          if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
            const children = await this.fetchAllBlocks(block.id, depth + 1);
            blocks.push(...children);
          }
        }
      }
      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return blocks;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.throttleMs) {
      await new Promise((r) => setTimeout(r, this.throttleMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private async rateLimited<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    await this.throttle();
    try {
      return await fn();
    } catch (err: unknown) {
      const status = err instanceof Object && "status" in err ? (err as { status: number }).status : 0;
      if (status === 429 && retries > 0) {
        const delay = Math.pow(2, 3 - retries) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        return this.rateLimited(fn, retries - 1);
      }
      throw err;
    }
  }
}

export function extractPageTitle(page: PageObjectResponse): string {
  const props = page.properties;
  for (const prop of Object.values(props)) {
    if (prop.type === "title" && prop.title.length > 0) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  return "Untitled";
}

function richTextToPlain(richText: RichTextItemResponse[]): string {
  return richText.map((t) => t.plain_text).join("");
}

export function blocksToText(blocks: BlockObjectResponse[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const line = blockToLine(block);
    if (line !== null) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}

function blockToLine(block: BlockObjectResponse): string | null {
  switch (block.type) {
    case "paragraph":
      return richTextToPlain(block.paragraph.rich_text);
    case "heading_1":
      return `# ${richTextToPlain(block.heading_1.rich_text)}`;
    case "heading_2":
      return `## ${richTextToPlain(block.heading_2.rich_text)}`;
    case "heading_3":
      return `### ${richTextToPlain(block.heading_3.rich_text)}`;
    case "bulleted_list_item":
      return `- ${richTextToPlain(block.bulleted_list_item.rich_text)}`;
    case "numbered_list_item":
      return `1. ${richTextToPlain(block.numbered_list_item.rich_text)}`;
    case "toggle":
      return richTextToPlain(block.toggle.rich_text);
    case "callout":
      return richTextToPlain(block.callout.rich_text);
    case "code":
      return `\`\`\`\n${richTextToPlain(block.code.rich_text)}\n\`\`\``;
    case "quote":
      return `> ${richTextToPlain(block.quote.rich_text)}`;
    case "to_do":
      return `${block.to_do.checked ? "[x]" : "[ ]"} ${richTextToPlain(block.to_do.rich_text)}`;
    case "divider":
      return "---";
    case "table_row":
      return block.table_row.cells.map((cell) => richTextToPlain(cell)).join(" | ");
    case "image":
    case "video":
    case "embed":
    case "file":
    case "bookmark":
    case "pdf":
      return null;
    default:
      return null;
  }
}

export async function listNotionItems(token: string, parentPageId?: string): Promise<NotionItemSummary[]> {
  const client = new Client({ auth: token, logLevel: LogLevel.ERROR });

  if (parentPageId) {
    const items: NotionItemSummary[] = [];
    let cursor: string | undefined;
    do {
      const response = await client.blocks.children.list({
        block_id: parentPageId,
        start_cursor: cursor,
        page_size: 100,
      });
      for (const block of response.results) {
        if ("type" in block && (block as BlockObjectResponse).type === "child_page") {
          const b = block as BlockObjectResponse & { child_page: { title: string } };
          items.push({
            id: block.id.replace(/-/g, ""),
            title: b.child_page.title,
            icon: null,
          });
        }
      }
      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    } while (cursor);
    items.sort((a, b) => a.title.localeCompare(b.title));
    return items;
  }

  const items: NotionItemSummary[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.search({
      filter: { property: "object", value: "page" },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const result of response.results) {
      if (isFullPage(result) && result.parent.type === "workspace") {
        items.push({
          id: result.id.replace(/-/g, ""),
          title: extractPageTitle(result),
          icon: result.icon?.type === "emoji" ? result.icon.emoji : null,
        });
      }
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  items.sort((a, b) => a.title.localeCompare(b.title));
  return items;
}

