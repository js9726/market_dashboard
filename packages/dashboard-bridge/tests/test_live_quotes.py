from __future__ import annotations

import unittest

from bridge.live_quotes import build_quote_universe, required_live_quote_symbols


class LiveQuoteUniverseTests(unittest.TestCase):
    def test_product_contract_includes_every_visible_group_and_crwd(self) -> None:
        required = required_live_quote_symbols()

        self.assertIn("CRWD", required)
        self.assertIn("SPY", required)
        self.assertIn("XLRE", required)
        self.assertEqual(len(required), len(set(required)))

    def test_positions_and_configured_extras_are_additive(self) -> None:
        universe, wants_vix = build_quote_universe(
            ["US.TENB", "CRWD"],
            ["HUT", "NVDA", "^VIX"],
        )

        self.assertTrue(wants_vix)
        self.assertIn("US.TENB", universe)
        self.assertIn("US.HUT", universe)
        self.assertIn("US.CRWD", universe)
        self.assertEqual(universe.count("US.NVDA"), 1)


if __name__ == "__main__":
    unittest.main()
