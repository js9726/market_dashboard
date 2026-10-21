from __future__ import annotations

import sys
import unittest
from unittest import mock

import backfill_deals


class BackfillPostTests(unittest.TestCase):
    def test_post_refuses_before_querying_opend(self) -> None:
        # --post sent positions=[]; /api/bridge/sync deletes every Position not in the payload.
        with mock.patch.object(sys, "argv", ["backfill_deals.py", "--post"]), \
                mock.patch.object(backfill_deals, "fetch") as fetch, \
                self.assertRaises(SystemExit) as exited:
            backfill_deals.main()

        fetch.assert_not_called()
        self.assertIn("bridge once --since", str(exited.exception.code))


if __name__ == "__main__":
    unittest.main()
