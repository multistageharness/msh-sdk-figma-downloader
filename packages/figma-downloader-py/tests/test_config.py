"""test_config.py — proxy + TLS resolution: flag > config > env > default."""

import json
import os
import tempfile
import unittest

from figma_downloader.cli import _resolve_timeout_ms
from figma_downloader.config import resolve_network_config


class TestConfig(unittest.TestCase):
    def _with_config(self, obj):
        d = tempfile.mkdtemp(prefix="figdl-cfg-")
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        file = os.path.join(d, "figma-download.config.json")
        with open(file, "w", encoding="utf-8") as f:
            json.dump(obj, f)
        return file

    def test_default(self):
        r = resolve_network_config({}, {})
        self.assertIsNone(r.proxy)
        self.assertTrue(r.ssl_verify)
        self.assertEqual(r.sources["proxy"], "default")
        self.assertEqual(r.sources["sslVerify"], "default")

    def test_env_proxy(self):
        r1 = resolve_network_config({}, {"HTTPS_PROXY": "http://envproxy:1"})
        self.assertEqual(r1.proxy, "http://envproxy:1")
        self.assertEqual(r1.sources["proxy"], "env")
        r2 = resolve_network_config({}, {"HTTPS_PROXY": "http://envproxy:1", "FIGMA_PROXY": "http://figproxy:2"})
        self.assertEqual(r2.proxy, "http://figproxy:2")

    def test_env_proxy_url_preferred(self):
        r1 = resolve_network_config({}, {"FIGMA_PROXY_URL": "http://urlproxy:5"})
        self.assertEqual(r1.proxy, "http://urlproxy:5")
        self.assertEqual(r1.sources["proxy"], "env")
        # FIGMA_PROXY_URL wins over the other env aliases.
        r2 = resolve_network_config({}, {
            "FIGMA_PROXY_URL": "http://urlproxy:5",
            "FIGMA_PROXY": "http://figproxy:2",
            "HTTPS_PROXY": "http://envproxy:1",
        })
        self.assertEqual(r2.proxy, "http://urlproxy:5")

    def test_env_ssl(self):
        self.assertFalse(resolve_network_config({}, {"FIGMA_SSL_VERIFY": "false"}).ssl_verify)
        self.assertFalse(resolve_network_config({}, {"FIGMA_SSL_VERIFY": "0"}).ssl_verify)
        self.assertTrue(resolve_network_config({}, {"FIGMA_SSL_VERIFY": "true"}).ssl_verify)
        self.assertFalse(resolve_network_config({}, {"NODE_TLS_REJECT_UNAUTHORIZED": "0"}).ssl_verify)

    def test_config_overrides_env(self):
        file = self._with_config({"proxy": "http://cfgproxy:3", "sslVerify": False})
        r = resolve_network_config({"config": file}, {"HTTPS_PROXY": "http://envproxy:1", "FIGMA_SSL_VERIFY": "true"})
        self.assertEqual(r.proxy, "http://cfgproxy:3")
        self.assertEqual(r.sources["proxy"], "config")
        self.assertFalse(r.ssl_verify)
        self.assertEqual(r.sources["sslVerify"], "config")

    def test_cli_overrides_config(self):
        file = self._with_config({"proxy": "http://cfgproxy:3", "sslVerify": False})
        r = resolve_network_config({"config": file, "proxy": "http://cliproxy:4", "ssl-verify": True}, {})
        self.assertEqual(r.proxy, "http://cliproxy:4")
        self.assertEqual(r.sources["proxy"], "cli")
        self.assertTrue(r.ssl_verify)
        self.assertEqual(r.sources["sslVerify"], "cli")

    def test_no_proxy_forces_direct(self):
        file = self._with_config({"proxy": "http://cfgproxy:3"})
        r = resolve_network_config({"config": file, "no-proxy": True}, {"HTTPS_PROXY": "http://envproxy:1"})
        self.assertIsNone(r.proxy)
        self.assertEqual(r.sources["proxy"], "cli")

    def test_no_ssl_verify_overrides_config(self):
        file = self._with_config({"sslVerify": True})
        r = resolve_network_config({"config": file, "no-ssl-verify": True}, {})
        self.assertFalse(r.ssl_verify)
        self.assertEqual(r.sources["sslVerify"], "cli")

    def test_bad_explicit_config_raises(self):
        with self.assertRaises(ValueError):
            resolve_network_config({"config": "/no/such/figma-config.json"}, {})


class TestTimeoutResolution(unittest.TestCase):
    """timeout: --timeout-ms flag > FIGMA_HTTP_TIMEOUT_MS env > 60000 default."""

    def test_default(self):
        self.assertEqual(_resolve_timeout_ms({}, {}), 60_000)

    def test_env(self):
        self.assertEqual(_resolve_timeout_ms({}, {"FIGMA_HTTP_TIMEOUT_MS": "12345"}), 12345)

    def test_flag_overrides_env(self):
        self.assertEqual(_resolve_timeout_ms({"timeout-ms": "999"}, {"FIGMA_HTTP_TIMEOUT_MS": "12345"}), 999)

    def test_blank_env_falls_back_to_default(self):
        self.assertEqual(_resolve_timeout_ms({}, {"FIGMA_HTTP_TIMEOUT_MS": "  "}), 60_000)

    def test_bad_env_raises(self):
        with self.assertRaises(ValueError):
            _resolve_timeout_ms({}, {"FIGMA_HTTP_TIMEOUT_MS": "abc"})


if __name__ == "__main__":
    unittest.main()
