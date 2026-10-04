from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collectors import collect_market, collect_news

NOW = datetime(2026, 10, 4, 10, tzinfo=timezone.utc)

class CollectorTests(unittest.TestCase):
    def test_missing_fields_never_become_zero_and_stale_quote_is_omitted(self):
        info = {"regularMarketTime": (NOW - timedelta(hours=1)).timestamp(), "regularMarketPrice": 100,
                "mostRecentQuarter": (NOW - timedelta(days=60)).timestamp(), "longBusinessSummary": "Business", "totalRevenue": None}
        rows, _ = collect_market("NTAP", NOW, lambda _: Mock(get_info=Mock(return_value=info)))
        self.assertEqual([s["kind"] for s in rows], ["fundamental"])
        self.assertNotIn("totalRevenue", rows[0]["text"])
        self.assertEqual(rows[0]["contentHash"], hashlib.sha256(rows[0]["text"].encode()).hexdigest())

    def test_only_fresh_market_timestamp_supplies_quote(self):
        info = {"regularMarketTime": NOW.timestamp(), "regularMarketPrice": 100}
        rows, _ = collect_market("NTAP", NOW, lambda _: Mock(get_info=Mock(return_value=info)))
        self.assertEqual(rows[0]["kind"], "quote")

    def test_ungrounded_news_never_supplies_evidence(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({"candidates": [{"content": {"parts": [{"text": "invented news"}]}, "groundingMetadata": {}}]}).encode()
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test", "RESEARCH_NEWS_MODEL": "explicit-model"}):
            rows, gaps = collect_news("NTAP", NOW, Mock(return_value=response))
        self.assertEqual(rows, []); self.assertTrue(gaps)

    def test_only_supported_segments_become_sources_without_exhaustive_coverage_claim(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({"candidates": [{"groundingMetadata": {
            "groundingChunks": [{"web": {"uri": "https://example.com/filing"}}],
            "groundingSupports": [{"segment": {"text": "Dated event"}, "groundingChunkIndices": [0]}]}}]}).encode()
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test", "RESEARCH_NEWS_MODEL": "explicit-model"}):
            rows, gaps = collect_news("NTAP", NOW, Mock(return_value=response))
        self.assertEqual(rows[0]["text"], "Dated event")
        self.assertNotIn("coverageFrom", rows[0]); self.assertTrue(gaps)

    def test_grounded_sources_are_bounded_below_checkpoint_limit(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({"candidates": [{"groundingMetadata": {
            "groundingChunks": [{"web": {"uri": f"https://example.com/{i}"}} for i in range(3)],
            "groundingSupports": [{"segment": {"text": "Event"}, "groundingChunkIndices": [0, 1, 2]} for _ in range(40)]}}]}).encode()
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test", "RESEARCH_NEWS_MODEL": "explicit-model"}):
            rows, gaps = collect_news("NTAP", NOW, Mock(return_value=response))
        self.assertEqual(len(rows), 60); self.assertIn("bounded", gaps[0])

if __name__ == "__main__": unittest.main()
