/**
 * POST /api/journal/entry/attachments
 *
 * Token-issuing endpoint for the @vercel/blob client-upload flow. The browser
 * calls `upload(pathname, file, { handleUploadUrl: '/api/journal/entry/attachments' })`
 * from @vercel/blob/client; that helper POSTs to this route, asks for a signed
 * upload token, then uploads the file DIRECTLY to Blob storage (avoids the
 * Vercel function payload limit and saves compute).
 *
 * Security:
 *   - Session required.
 *   - allowedContentTypes restricts to images only.
 *   - addRandomSuffix=true so the final URL is unguessable.
 *   - We refuse pathnames that don't start with `journal/` so this route
 *     can't be reused to write to other prefixes.
 *
 * If BLOB_READ_WRITE_TOKEN isn't set we return 503 with a clear message
 * instead of a stack trace, so the rest of the journal still works.
 */
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/journal/attachments";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Blob storage is not configured. Set BLOB_READ_WRITE_TOKEN to enable uploads." },
      { status: 503 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = scopeUserId(session)!;

  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("journal/")) {
          throw new Error("Pathname must start with 'journal/'");
        }
        return {
          allowedContentTypes: [...ALLOWED_MIME_TYPES],
          maximumSizeInBytes: MAX_FILE_SIZE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId }),
        };
      },
      onUploadCompleted: async () => {
        // No-op for now. URL is stored when the user saves the entry.
        // Could later: log to an audit table, run a virus scan, etc.
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload token error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
