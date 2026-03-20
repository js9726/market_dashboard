function AnalysisResult({ analysis, ticker }: { analysis: any; ticker: string }) {
  const combined = analysis.combined_analysis[ticker];
  const fundamental = combined.fundamental;
  const technical = combined.technical;

  return (
    <div className="space-y-4">
      {/* Overall Signal */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <h3 className="text-lg font-semibold">Overall Signal</h3>
          <p className={`text-2xl font-bold ${
            combined.overall_signal === 'bullish' ? 'text-green-600' :
            combined.overall_signal === 'bearish' ? 'text-red-600' :
            'text-gray-600'
          }`}>
            {combined.overall_signal.toUpperCase()}
          </p>
          <p className="text-sm text-gray-600">Confidence: {combined.confidence}%</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-600">Fundamental: {fundamental.signal.toUpperCase()}</p>
          <p className="text-sm text-gray-600">Technical: {technical.signal.toUpperCase()}</p>
        </div>
      </div>

      {/* Fundamental Analysis */}
      <div className="p-4 bg-white rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-3">Fundamental Analysis</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium text-gray-700">Profitability</h4>
            <p className="text-sm text-gray-600">{fundamental.reasoning.profitability_signal.details}</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Growth</h4>
            <p className="text-sm text-gray-600">{fundamental.reasoning.growth_signal.details}</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Financial Health</h4>
            <p className="text-sm text-gray-600">{fundamental.reasoning.financial_health_signal.details}</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Price Ratios</h4>
            <p className="text-sm text-gray-600">{fundamental.reasoning.price_ratios_signal.details}</p>
          </div>
        </div>
      </div>

      {/* Technical Analysis */}
      <div className="p-4 bg-white rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-3">Technical Analysis</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium text-gray-700">Trend</h4>
            <p className="text-sm text-gray-600">{technical.reasoning.trend_signal.details}</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Momentum</h4>
            <p className="text-sm text-gray-600">{technical.reasoning.momentum_signal.details}</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Volume</h4>
            <p className="text-sm text-gray-600">{technical.reasoning.volume_signal.details}</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Support/Resistance</h4>
            <p className="text-sm text-gray-600">{technical.reasoning.support_resistance_signal.details}</p>
          </div>
        </div>
      </div>

      {/* Technical Indicators */}
      <div className="p-4 bg-white rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-3">Technical Indicators</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium text-gray-700">Moving Averages</h4>
            <p className="text-sm text-gray-600">
              SMA 20: {technical.metrics.moving_averages.sma_20.toFixed(2)}<br />
              SMA 50: {technical.metrics.moving_averages.sma_50.toFixed(2)}<br />
              SMA 200: {technical.metrics.moving_averages.sma_200.toFixed(2)}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Momentum</h4>
            <p className="text-sm text-gray-600">
              RSI: {technical.metrics.rsi.toFixed(2)}<br />
              MACD: {technical.metrics.macd.macd.toFixed(2)}<br />
              Signal: {technical.metrics.macd.signal.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 