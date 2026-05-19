import { NextResponse } from "next/server";
import { fundamentalsAgent } from "../../../../agents/fundamental/capability";
import { technicalAgent } from "../../../../agents/technical/capability";
import { formatTickers } from "@/utils/format";
import { auth } from "@/auth";
import type { AgentMessage } from "@/types/agent";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.tickers || !Array.isArray(body.tickers)) {
      return NextResponse.json(
        { error: 'Invalid request: tickers array is required' },
        { status: 400 }
      );
    }

    const formattedTickers = formatTickers(body.tickers);

    const state = {
      data: {
        tickers: formattedTickers,
        end_date: body.endDate || new Date().toISOString(),
        analyst_signals: {}
      },
      metadata: {
        show_reasoning: true,
        provider: body.provider as string | undefined,
      }
    };

    try {
      const fundamentalResult = await fundamentalsAgent(state);

      // Only run technical analysis if DeepSeek is available (the technical
      // agent calls DeepSeek for signal reasoning).
      let technicalResult: Awaited<ReturnType<typeof technicalAgent>> = {
        messages: [] as AgentMessage[],
        data: { ...state.data, analyst_signals: { technical_agent: {} } },
      };

      if (process.env.DEEPSEEK_API_KEY) {
        try {
          technicalResult = await technicalAgent(state);
        } catch (error) {
          console.error("Technical analysis unavailable:", error);
        }
      }

      // Combine the results
      const response = {
        messages: [...fundamentalResult.messages, ...technicalResult.messages],
        data: {
          ...state.data,
          analyst_signals: {
            fundamentals_agent: fundamentalResult.data.analyst_signals.fundamentals_agent,
            technical_agent: technicalResult.data.analyst_signals.technical_agent
          },
          combined_analysis: fundamentalResult.data.analyst_signals.fundamentals_agent // Use fundamental analysis when technical is unavailable
        }
      };

      return NextResponse.json(response);
    } catch (error) {
      console.error('Analysis error:', error);
      if (error instanceof Error) {
        if (error.message.includes('404') || error.message.includes('not found')) {
          return NextResponse.json(
            { error: `Stock symbol not found. Please check the symbol and try again.` },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { error: `Analysis failed: ${error.message}` },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: 'An unexpected error occurred during analysis' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
} 