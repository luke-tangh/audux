import unittest

import app.local_security as security


class TestLocalSecurity(unittest.TestCase):
    def setUp(self):
        self._old_allow_all_cors = security.ALLOW_ALL_CORS
        security.ALLOW_ALL_CORS = False

    def tearDown(self):
        security.ALLOW_ALL_CORS = self._old_allow_all_cors

    def test_allowed_request_origins(self):
        allowed = [
            "http://localhost:5173",
            "https://localhost",
            "http://127.0.0.1:5173",
            "http://127.0.0.2:3000",
            "http://[::1]:5173",
            "http://foo.localhost:5173",
            "https://tauri.localhost",
            "tauri://localhost",
        ]

        for origin in allowed:
            with self.subTest(origin=origin):
                self.assertTrue(security._is_allowed_request_origin(origin))

    def test_disallowed_request_origins(self):
        disallowed = [
            "https://example.com",
            "http://localhost.evil.com",
            "file://localhost/path",
            "ftp://localhost",
            "not-a-url",
        ]

        for origin in disallowed:
            with self.subTest(origin=origin):
                self.assertFalse(security._is_allowed_request_origin(origin))

    def test_local_llm_endpoints(self):
        endpoints = [
            "http://localhost:1234/v1",
            "http://127.0.0.1:1234/v1",
            "http://127.1.2.3:1234/v1",
            "http://[::1]:8765/v1",
            "http://model.localhost/v1",
        ]

        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                self.assertTrue(security._is_local_endpoint(endpoint))
                self.assertIsNone(security._llm_privacy_warning(endpoint))

    def test_remote_llm_endpoints_have_privacy_warning(self):
        endpoints = [
            "https://example.com/v1",
            "http://192.168.1.2:1234/v1",
            "http://10.0.0.2:1234/v1",
            "not-a-url",
        ]

        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                self.assertFalse(security._is_local_endpoint(endpoint))

                warning = security._llm_privacy_warning(endpoint)
                self.assertIsNotNone(warning)
                self.assertIn("不是 localhost", warning)

    def test_asr_privacy_warning_describes_full_audio_upload(self):
        self.assertIsNone(
            security._asr_privacy_warning("http://127.0.0.1:8000/v1")
        )

        warning = security._asr_privacy_warning("https://asr.example.com/v1")
        self.assertIsNotNone(warning)
        self.assertIn("完整音频文件", warning)

    def test_setting_truthy(self):
        truthy_values = ["1", "true", "TRUE", "yes", "on", " On "]
        falsey_values = ["", "0", "false", "no", "off", None]

        for value in truthy_values:
            with self.subTest(value=value):
                self.assertTrue(security._setting_truthy(value))

        for value in falsey_values:
            with self.subTest(value=value):
                self.assertFalse(security._setting_truthy(value))


if __name__ == "__main__":
    unittest.main()
