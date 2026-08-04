import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatTelegramGoList,
  goListPayloadHash,
  type DailyScreenerPayload,
} from "@/lib/daily-screener/schema";

type TelegramDeliveryResult =
  | { status: "sent"; messageId: string | null }
  | { status: "already_sent" | "in_progress" }
  | { status: "not_configured"; missing: string[] }
  | { status: "failed"; error: string };

function telegramConfig():
  | { token: string; chatId: string; threadId?: number }
  | { missing: string[] } {
  const token = process.env.TELEGRAM_GO_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GO_CHAT_ID;
  const missing = [
    !token ? "TELEGRAM_GO_BOT_TOKEN" : null,
    !chatId ? "TELEGRAM_GO_CHAT_ID" : null,
  ].filter((name): name is string => Boolean(name));
  if (missing.length > 0) return { missing };

  const rawThreadId = process.env.TELEGRAM_GO_THREAD_ID;
  const threadId = rawThreadId ? Number(rawThreadId) : undefined;
  return {
    token: token!,
    chatId: chatId!,
    ...(Number.isInteger(threadId) && Number(threadId) > 0
      ? { threadId: Number(threadId) }
      : {}),
  };
}

function safeTelegramError(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  if (value && typeof value === "object") {
    const description = (value as { description?: unknown }).description;
    if (typeof description === "string") return description.slice(0, 500);
  }
  return "Telegram sendMessage failed";
}

async function claimDelivery(
  dedupeKey: string,
  payloadHash: string,
): Promise<"claimed" | "already_sent" | "in_progress"> {
  try {
    await prisma.telegramDelivery.create({
      data: {
        dedupeKey,
        kind: "GO_LIST",
        payloadHash,
        status: "PENDING",
      },
    });
    return "claimed";
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }

  const existing = await prisma.telegramDelivery.findUnique({
    where: { dedupeKey },
    select: { status: true, updatedAt: true },
  });
  if (existing?.status === "SENT") return "already_sent";

  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const retry = await prisma.telegramDelivery.updateMany({
    where: {
      dedupeKey,
      OR: [
        { status: "FAILED" },
        { status: "PENDING", updatedAt: { lte: staleBefore } },
      ],
    },
    data: {
      status: "PENDING",
      attemptedAt: new Date(),
      errorMessage: null,
      payloadHash,
    },
  });
  return retry.count === 1 ? "claimed" : "in_progress";
}

export async function deliverTelegramGoList(
  payload: DailyScreenerPayload,
): Promise<TelegramDeliveryResult> {
  const config = telegramConfig();
  if ("missing" in config) {
    return { status: "not_configured", missing: config.missing };
  }

  const payloadHash = goListPayloadHash(payload);
  const dedupeKey = `go-list:${payload.runDate}:${payloadHash}`;
  const claim = await claimDelivery(dedupeKey, payloadHash);
  if (claim !== "claimed") return { status: claim };

  try {
    const dashboardBase = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
    const text = formatTelegramGoList(
      payload,
      dashboardBase ? `${dashboardBase}/dashboard/trades` : undefined,
    );
    const response = await fetch(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(config.threadId ? { message_thread_id: config.threadId } : {}),
        }),
      },
    );
    const result = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string; result?: { message_id?: number } }
      | null;
    if (!response.ok || result?.ok !== true) {
      throw new Error(safeTelegramError(result ?? response.statusText));
    }

    const messageId =
      result.result?.message_id == null ? null : String(result.result.message_id);
    await prisma.telegramDelivery.update({
      where: { dedupeKey },
      data: {
        status: "SENT",
        sentAt: new Date(),
        telegramMessageId: messageId,
        errorMessage: null,
      },
    });
    return { status: "sent", messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown Telegram error";
    await prisma.telegramDelivery.update({
      where: { dedupeKey },
      data: { status: "FAILED", errorMessage: message },
    });
    return { status: "failed", error: message };
  }
}
