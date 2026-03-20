import { NextResponse } from 'next/server';
import { fundamentalsAgent } from '../../../../agents/fundamental/capability';
import { technicalAgent } from '../../../../agents/technical/capability';
import { formatTickers } from '@/utils/format';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('\n=== API Request ===');
    console.log('Received request body:', JSON.stringify(body, null, 2));

    if (!body.tickers || !Array.isArray(body.tickers)) {
      console.error('Invalid request: tickers array is missing or invalid');
      return NextResponse.json(
        { error: 'Invalid request: tickers array is required' },
        { status: 400 }
      );
    }

    // Format tickers (remove $ symbol and trim)
    const formattedTickers = formatTickers(body.tickers);
    console.log('\n=== Formatted Tickers ===');
    console.log('Original tickers:', body.tickers);
    console.log('Formatted tickers:', formattedTickers);

    const state = {
      data: {
        tickers: formattedTickers,
        end_date: body.endDate || new Date().toISOString(),
        analyst_signals: {}
      },
      metadata: {
        show_reasoning: true
      }
    };

    console.log('\n=== Analysis State ===');
    console.log('State:', JSON.stringify(state, null, 2));

    try {
      console.log('\n=== Starting Analysis ===');
      // Run fundamental analysis first
      const fundamentalResult = await fundamentalsAgent(state);
      
      // Only run technical analysis if OpenAI is available
      let technicalResult = {
        messages: [],
        data: { ...state.data, analyst_signals: { technical_agent: {} } }
      };
      
      if (process.env.DEEPSEEK_API_KEY) {
        try {
          technicalResult = await technicalAgent(state);
        } catch (error) {
          console.log("Technical analysis unavailable:", error);
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
      console.error('\n=== Analysis Error ===');
      console.error('Error details:', error);
      
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
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
    console.error('\n=== API Route Error ===');
    console.error('Error details:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
} 