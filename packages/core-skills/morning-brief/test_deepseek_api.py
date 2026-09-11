import json
import unittest

from deepseek_api import (
    DEEPSEEK_MODEL_ID,
    DEEPSEEK_RESPONSES_URL,
    build_response_payload,
    call_deepseek_json,
    extract_output_text,
)


class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class DeepSeekApiTests(unittest.TestCase):
    def test_payload_uses_current_model_and_official_web_search_tool(self):
        payload = build_response_payload("Return JSON", web_search=True)
        self.assertEqual(payload["model"], "deepseek-v4-flash")
        self.assertEqual(payload["tools"], [{"type": "web_search"}])
        self.assertEqual(payload["text"], {"format": {"type": "json_object"}})
        self.assertNotIn("search_options", payload)

    def test_extracts_only_message_output_text(self):
        text = extract_output_text({
            "status": "completed",
            "output": [
                {"type": "reasoning", "content": [{"type": "reasoning_text", "text": "private"}]},
                {"type": "message", "content": [{"type": "output_text", "text": '{"ok":true}'}]},
            ],
        })
        self.assertEqual(text, '{"ok":true}')

    def test_incomplete_response_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "status=incomplete"):
            extract_output_text({"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}})

    def test_missing_key_fails_without_network(self):
        with self.assertRaisesRegex(RuntimeError, "no provider fallback"):
            call_deepseek_json("x", api_key="")

    def test_request_targets_responses_endpoint(self):
        seen = {}

        def fake_urlopen(request, timeout):
            seen["url"] = request.full_url
            seen["payload"] = json.loads(request.data.decode("utf-8"))
            seen["timeout"] = timeout
            return _FakeResponse({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "{}"}]}],
            })

        self.assertEqual(call_deepseek_json("x", api_key="secret", urlopen=fake_urlopen), "{}")
        self.assertEqual(seen["url"], DEEPSEEK_RESPONSES_URL)
        self.assertEqual(seen["payload"]["model"], DEEPSEEK_MODEL_ID)


if __name__ == "__main__":
    unittest.main()
