/**
 * Google Docs writer for the automated daily journal (WS4).
 *
 * Mirrors the googleapis + OAuth2 pattern in `lib/google-sheets.ts`: an OAuth2
 * client is seeded with a Google access token (from `getGoogleAccessToken`),
 * then handed to `google.docs({ version: "v1", auth })`.
 *
 * The public entry point is `appendMarkdownSection(docUrlOrId, markdown, opts)`.
 * It parses a Google Doc URL → documentId, converts a small Markdown subset
 * into Docs `batchUpdate` requests, and appends a dated section to the END of
 * the document.
 *
 * Markdown subset supported (deliberately small + robust):
 *   - `# H1`, `## H2`, `### H3`              → named paragraph styles
 *   - `- ` / `* ` / `1. ` bullets            → bulleted list paragraphs
 *   - `**bold**` inline                      → bold text runs
 *   - everything else                        → plain NORMAL_TEXT paragraphs
 *
 * Idempotency: every section is prefixed with a `## YYYY-MM-DD` date header.
 * `appendMarkdownSection` first reads the doc; if that exact date header text
 * already exists in the body, it skips the write (returns skipped:true) unless
 * `opts.force` is set. This keeps the cron safe to re-run.
 */
import { google } from "googleapis";
import type { docs_v1 } from "googleapis";
import { getGoogleAccessToken } from "@/lib/token-refresh";

export const DOCS_SCOPE = "https://www.googleapis.com/auth/documents";

export interface AppendOptions {
  /** Resolve + use this user's Google OAuth token. Required unless `accessToken` is passed. */
  userId?: string;
  /** Pre-fetched Google access token (skips getGoogleAccessToken). */
  accessToken?: string;
  /** Date header text to prepend (defaults to today, YYYY-MM-DD). */
  dateLabel?: string;
  /** Skip the "already has this date header" guard and append regardless. */
  force?: boolean;
  /** Optional sub-title rendered under the date header (e.g. "Daily Journal"). */
  title?: string;
}

export interface AppendResult {
  ok: boolean;
  documentId: string | null;
  skipped?: boolean;
  reason?: string;
  requests?: number;
}

/**
 * Parse a Google Doc URL or bare ID into a documentId.
 * Accepts:
 *   https://docs.google.com/document/d/<ID>/edit
 *   https://docs.google.com/document/d/<ID>
 *   <ID> (already an id — 25+ url-safe chars)
 * Returns null when nothing usable is found.
 */
export function parseDocId(docUrlOrId: string | null | undefined): string | null {
  if (!docUrlOrId) return null;
  const raw = docUrlOrId.trim();
  if (!raw) return null;

  // Full / partial URL form: /document/d/<ID>
  const m = raw.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (m?.[1]) return m[1];

  // Some share URLs use ?id=<ID>
  try {
    const u = new URL(raw);
    const idParam = u.searchParams.get("id");
    if (idParam && /^[a-zA-Z0-9_-]{20,}$/.test(idParam)) return idParam;
  } catch {
    /* not a URL — fall through to bare-id check */
  }

  // Bare id (Google Doc ids are long url-safe strings). Reject obvious URLs.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return null;
}

function makeDocsClient(accessToken: string): docs_v1.Docs {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.docs({ version: "v1", auth: oauth2 });
}

// ── Inline (bold) parsing ────────────────────────────────────────────────────

type InlineSpan = { text: string; bold: boolean };

/** Split a line into bold / non-bold spans on `**...**`. */
function parseInline(line: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > last) {
      spans.push({ text: line.slice(last, match.index), bold: false });
    }
    spans.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last), bold: false });
  if (spans.length === 0) spans.push({ text: line, bold: false });
  return spans;
}

// ── Markdown → structured blocks ─────────────────────────────────────────────

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { kind: "bullet"; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] };

function parseMarkdownBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    if (line.trim() === "") {
      // Preserve blank lines as empty paragraphs so spacing survives.
      blocks.push({ kind: "paragraph", spans: [{ text: "", bold: false }] });
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, spans: parseInline(h[2].trim()) });
      continue;
    }
    const b = line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (b) {
      blocks.push({ kind: "bullet", spans: parseInline(b[1].trim()) });
      continue;
    }
    blocks.push({ kind: "paragraph", spans: parseInline(line) });
  }
  return blocks;
}

const HEADING_STYLE: Record<1 | 2 | 3, string> = {
  1: "HEADING_1",
  2: "HEADING_2",
  3: "HEADING_3",
};

/**
 * Build the Docs batchUpdate requests for a list of blocks, inserting at
 * `startIndex`. Returns the requests plus the running index after insertion.
 *
 * Strategy: we insert text top-to-bottom. To keep indices stable we always
 * insert at a single growing cursor and apply styling to the just-inserted
 * range. Each block ends with a trailing "\n" that becomes its paragraph break.
 */
function buildRequestsForBlocks(
  blocks: Block[],
  startIndex: number,
): { requests: docs_v1.Schema$Request[]; endIndex: number } {
  const requests: docs_v1.Schema$Request[] = [];
  let cursor = startIndex;

  for (const block of blocks) {
    const text = block.spans.map((s) => s.text).join("");
    const paragraphStart = cursor;
    const content = text + "\n";

    requests.push({
      insertText: { location: { index: cursor }, text: content },
    });

    // Bold runs (relative to paragraphStart).
    let runOffset = 0;
    for (const span of block.spans) {
      const len = span.text.length;
      if (span.bold && len > 0) {
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: paragraphStart + runOffset,
              endIndex: paragraphStart + runOffset + len,
            },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
      }
      runOffset += len;
    }

    const paragraphEnd = paragraphStart + content.length;

    if (block.kind === "heading") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: paragraphStart, endIndex: paragraphEnd },
          paragraphStyle: { namedStyleType: HEADING_STYLE[block.level] },
          fields: "namedStyleType",
        },
      });
    } else {
      // Ensure non-heading paragraphs are NORMAL_TEXT (a previous heading style
      // can otherwise "leak" onto the next inserted paragraph).
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: paragraphStart, endIndex: paragraphEnd },
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          fields: "namedStyleType",
        },
      });
      if (block.kind === "bullet") {
        requests.push({
          createParagraphBullets: {
            range: { startIndex: paragraphStart, endIndex: paragraphEnd },
            bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
          },
        });
      }
    }

    cursor = paragraphEnd;
  }

  return { requests, endIndex: cursor };
}

/** Concatenate all text runs in a Docs body so we can scan for an existing date header. */
function bodyText(doc: docs_v1.Schema$Document): string {
  const out: string[] = [];
  const content = doc.body?.content ?? [];
  for (const el of content) {
    const elems = el.paragraph?.elements ?? [];
    for (const e of elems) {
      const t = e.textRun?.content;
      if (t) out.push(t);
    }
  }
  return out.join("");
}

/** End index of the document body (where we append). Docs body always has a
 *  trailing newline segment; we insert just before it. */
function bodyEndIndex(doc: docs_v1.Schema$Document): number {
  const content = doc.body?.content ?? [];
  let end = 1;
  for (const el of content) {
    if (typeof el.endIndex === "number") end = el.endIndex;
  }
  // The final structural newline lives at end-1; inserting there keeps the doc valid.
  return Math.max(1, end - 1);
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Append a dated Markdown section to the end of a Google Doc.
 *
 * - Resolves the documentId from a URL or bare id.
 * - Resolves a Google access token from `opts.userId` (or uses `opts.accessToken`).
 * - Skips (idempotent) when a `## <dateLabel>` header already exists, unless
 *   `opts.force`.
 * - Returns a structured result; never throws for the common "no doc / bad URL"
 *   cases — callers can branch on `ok`.
 */
export async function appendMarkdownSection(
  docUrlOrId: string | null | undefined,
  markdown: string,
  opts: AppendOptions = {},
): Promise<AppendResult> {
  const documentId = parseDocId(docUrlOrId);
  if (!documentId) {
    return { ok: false, documentId: null, reason: "invalid_doc_url" };
  }

  let accessToken = opts.accessToken;
  if (!accessToken) {
    if (!opts.userId) {
      return { ok: false, documentId, reason: "missing_user_or_token" };
    }
    try {
      accessToken = await getGoogleAccessToken(opts.userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, documentId, reason: `token_error:${msg}` };
    }
  }

  const docs = makeDocsClient(accessToken);
  const dateLabel = opts.dateLabel ?? todayIso();
  const dateHeader = `## ${dateLabel}`;

  // Read existing doc to (a) find the append point and (b) dedupe by date header.
  let doc: docs_v1.Schema$Document;
  try {
    const res = await docs.documents.get({ documentId });
    doc = res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, documentId, reason: `read_failed:${msg}` };
  }

  const existing = bodyText(doc);
  if (!opts.force && existing.includes(dateLabel) && new RegExp(`(^|\\n)\\s*${escapeRegExp(dateLabel)}`).test(existing)) {
    return { ok: true, documentId, skipped: true, reason: "date_already_present" };
  }

  // Compose the section markdown: date header (+ optional title) then the body.
  const headerLines = [dateHeader];
  if (opts.title) headerLines.push(`**${opts.title}**`);
  const sectionMarkdown = `${headerLines.join("\n")}\n\n${markdown.trim()}\n`;

  const blocks = parseMarkdownBlocks(sectionMarkdown);
  const insertAt = bodyEndIndex(doc);
  const { requests } = buildRequestsForBlocks(blocks, insertAt);

  if (requests.length === 0) {
    return { ok: true, documentId, skipped: true, reason: "empty_section" };
  }

  try {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, documentId, reason: `write_failed:${msg}` };
  }

  return { ok: true, documentId, requests: requests.length };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
