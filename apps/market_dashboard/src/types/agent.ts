export interface AgentMessage {
  content: string;
  name?: string;
}

export interface AgentState {
  data: {
    end_date: string;
    tickers: string[];
    analyst_signals: {
      [key: string]: unknown;
    };
  };
  metadata: {
    show_reasoning: boolean;
    provider?: string;
  };
}
