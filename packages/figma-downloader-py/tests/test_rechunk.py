"""test_rechunk.py — byte-aware re-chunking (TR-3) stays lossless and idempotent."""

import json
import os
import shutil
import tempfile
import unittest

from figma_downloader.cli import run
from figma_downloader.mock import MOCK_FILE


def part_names(d):
    return sorted(f for f in os.listdir(os.path.join(d, "parts")) if f.startswith("part-"))


class TestRechunk(unittest.TestCase):
    def setUp(self):
        self.dirs = []

    def tearDown(self):
        for d in self.dirs:
            shutil.rmtree(d, ignore_errors=True)

    def _tmp(self):
        d = tempfile.mkdtemp(prefix="figdl-rc-")
        self.dirs.append(d)
        return d

    def test_tiny_budget_splits_but_lossless(self):
        d = self._tmp()
        code = run(["--mock", "--depth", "2", "--max-part-bytes", "200", "--keep-parts", "--work-dir", d, "--quiet"])
        self.assertEqual(code, 0)
        full = json.load(open(os.path.join(d, "full.json"), encoding="utf-8"))
        self.assertEqual(full["document"], MOCK_FILE["document"])
        manifest = json.load(open(os.path.join(d, "manifest.json"), encoding="utf-8"))
        self.assertGreaterEqual(manifest["rechunked"], 1)
        self.assertGreater(len(manifest["parts"]), 3)

    def test_deterministic_part_names(self):
        a, b = self._tmp(), self._tmp()
        run(["--mock", "--depth", "2", "--max-part-bytes", "200", "--keep-parts", "--work-dir", a, "--quiet"])
        run(["--mock", "--depth", "2", "--max-part-bytes", "200", "--keep-parts", "--work-dir", b, "--quiet"])
        self.assertEqual(part_names(a), part_names(b))

    def test_generous_budget_no_rechunk(self):
        d = self._tmp()
        run(["--mock", "--depth", "2", "--batch-size", "1", "--max-part-bytes", "10000000", "--keep-parts", "--work-dir", d, "--quiet"])
        manifest = json.load(open(os.path.join(d, "manifest.json"), encoding="utf-8"))
        self.assertEqual(manifest["rechunked"], 0)
        self.assertEqual(len(manifest["parts"]), 3)


if __name__ == "__main__":
    unittest.main()
