"""test_errors.py — typed error taxonomy (TR-16) + CLI exit-code mapping."""

import unittest

from figma_downloader import client as client_mod
from figma_downloader.client import figma_get
from figma_downloader.cli import run
from figma_downloader.errors import (
    FigmaAuthError,
    FigmaError,
    FigmaNetworkError,
    FigmaNotFoundError,
    FigmaRateLimitError,
    FigmaServerError,
    exit_code_for,
)
from figma_downloader.http_fetch import Response


def status_fetch(status, body="{}"):
    def f(url, headers=None, timeout_ms=60000):
        return Response(status >= 200 and status < 300, status, body, {})
    return f


class TestErrors(unittest.TestCase):
    def setUp(self):
        self._orig = client_mod._http["fetch"]

    def tearDown(self):
        client_mod._http["fetch"] = self._orig

    def _get(self, fetch_impl):
        client_mod._http["fetch"] = fetch_impl
        return figma_get("/files/X?depth=2", "tok", retries=0)

    def test_401_403_auth(self):
        with self.assertRaises(FigmaAuthError) as cm:
            self._get(status_fetch(401))
        self.assertEqual(cm.exception.exit_code, 3)
        self.assertFalse(cm.exception.retryable)
        with self.assertRaises(FigmaAuthError):
            self._get(status_fetch(403))

    def test_404_not_found(self):
        with self.assertRaises(FigmaNotFoundError) as cm:
            self._get(status_fetch(404))
        self.assertEqual(cm.exception.exit_code, 4)

    def test_429_rate_limit(self):
        with self.assertRaises(FigmaRateLimitError) as cm:
            self._get(status_fetch(429))
        self.assertEqual(cm.exception.exit_code, 5)
        self.assertTrue(cm.exception.retryable)

    def test_500_server(self):
        with self.assertRaises(FigmaServerError) as cm:
            self._get(status_fetch(500))
        self.assertEqual(cm.exception.exit_code, 6)

    def test_network(self):
        def netfetch(url, headers=None, timeout_ms=60000):
            raise ConnectionError("reset")
        with self.assertRaises(FigmaNetworkError) as cm:
            self._get(netfetch)
        self.assertEqual(cm.exception.exit_code, 6)

    def test_missing_token(self):
        with self.assertRaises(FigmaError) as cm:
            figma_get("/files/X", "", retries=0)
        self.assertEqual(cm.exception.exit_code, 3)

    def test_exit_code_for(self):
        self.assertEqual(exit_code_for(FigmaNotFoundError("x")), 4)
        self.assertEqual(exit_code_for(ValueError("x")), 1)

    def test_cli_missing_token_returns_3(self):
        code = run(["--file-key", "SOMEKEY1234567890ABCD", "--quiet"], env={})
        self.assertEqual(code, 3)


if __name__ == "__main__":
    unittest.main()
