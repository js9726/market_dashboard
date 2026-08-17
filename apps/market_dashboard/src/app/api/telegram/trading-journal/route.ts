import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseJournalThought } from "@/lib/trading-journal/thoughts";

export const dynamic = "force-dynamic";

type TelegramUpdate = {
  message?: {
    message_id?: number;
    date?: number;
    text?: string;
    chat?: { id?: number };
  };
};

function authorized(req: Request): boolean {
  const secret = process.env.TELEGRAM_JOURNAL_WEBHOOK_SECRET;
  return Boolean(secret) && req.headers.get("x-telegram-bot-api-secret-token") === secret;
}

async function ownerUser() {
  const email = process.env.OWNER_EMAIL;
  if (!email) throw new Error("OWNER_EMAIL not set");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error("OWNER_EMAIL user not found");
  return user;
}

async function acknowledge(chatId: string, text: string) {
  const token = process.env.TELEGRAM_GO_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const message = update.message;
  const chatId = message?.chat?.id == null ? null : String(message.chat.id);
  const expectedChatId = process.env.TELEGRAM_GO_CHAT_ID;
  if (!chatId || !expectedChatId || chatId !== expectedChatId) {
    return NextResponse.json({ ok: true, ignored: "chat_not_authorized" });
  }
  const capturedAt = message?.date ? new Date(message.date * 1000) : new Date();
  const thought = parseJournalThought(message?.text, capturedAt);
  if (!thought || message?.message_id == null) {
    return NextResponse.json({ ok: true, ignored: "no_explicit_journal_intent" });
  }

  try {
    const user = await ownerUser();
    const externalMessageId = `telegram:${chatId}:${message.message_id}`;
    const existing = await prisma.tradingJournalThought.findUnique({ where: { externalMessageId } });
    const row = existing ?? await prisma.tradingJournalThought.create({
      data: {
        userId: user.id,
        sessionDate: new Date(`${thought.sessionDate}T00:00:00.000Z`),
        source: "telegram",
        externalMessageId,
        text: thought.text,
        capturedAt,
      },
    });
    if (!existing) await acknowledge(chatId, `Journal thought saved for US session ${thought.sessionDate}.`);
    return NextResponse.json({ ok: true, id: row.id, sessionDate: thought.sessionDate, action: existing ? "existing" : "created" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "capture_failed" }, { status: 503 });
  }
}
