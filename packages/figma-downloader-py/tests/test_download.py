"""test_download.py — unit + end-to-end coverage, all offline (mock fetch)."""

import json
import os
import re
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from figma_downloader import client as client_mod
from figma_downloader.chunk import collect_frontier_ids
from figma_downloader.client import fetch_nodes, fetch_skeleton, fetch_whole_file, parse_file_key
from figma_downloader.cli import run
from figma_downloader.http_fetch import make_fetch, redact_proxy
from figma_downloader.mock import MOCK_FILE, make_mock_fetch
from figma_downloader.reconstruct import index_parts, reconstruct
from figma_downloader.util import batch, byte_length, count_nodes, pool, sha256_of_batch, stringify


class TestUnits(unittest.TestCase):
    def test_parse_file_key(self):
        self.assertEqual(parse_file_key("https://www.figma.com/design/TFTCSGbqpyxex6QRYqqbzb/About"), "TFTCSGbqpyxex6QRYqqbzb")
        self.assertEqual(parse_file_key("https://www.figma.com/file/ABCDEFGHIJ/Name"), "ABCDEFGHIJ")
        self.assertEqual(parse_file_key("out/TFTCSGbqpyxex6QRYqqbzb/full.json"), "TFTCSGbqpyxex6QRYqqbzb")
        self.assertEqual(parse_file_key(""), "")

    def test_util(self):
        self.assertEqual(batch([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
        self.assertEqual(pool([1, 2], 1, lambda x: x * 2), [2, 4])
        self.assertEqual(count_nodes(MOCK_FILE["document"]), 17)
        self.assertEqual(sha256_of_batch(["b", "a"]), sha256_of_batch(["a", "b"]))
        self.assertEqual(len(sha256_of_batch(["a", "b"])), 12)

    def test_stringify_escapes_separators(self):
        ls = chr(0x2028)
        ps = chr(0x2029)
        obj = {"text": f"a{ls}b{ps}c"}
        out = stringify(obj)
        self.assertNotIn(ls, out)
        self.assertNotIn(ps, out)
        self.assertIn("\\u2028", out)
        self.assertIn("\\u2029", out)
        self.assertEqual(json.loads(out), obj)

    def test_collect_frontier_ids(self):
        self.assertEqual(collect_frontier_ids(MOCK_FILE, 1), ["0:1"])
        self.assertEqual(collect_frontier_ids(MOCK_FILE, 2), ["1:100", "1:200", "1:300"])


class TestClient(unittest.TestCase):
    def setUp(self):
        self._orig = client_mod._http["fetch"]
        client_mod._http["fetch"] = make_mock_fetch()

    def tearDown(self):
        client_mod._http["fetch"] = self._orig

    def test_skeleton_nodes_whole(self):
        skel = fetch_skeleton("KEY", "tok", depth=2)
        frame = skel["document"]["children"][0]["children"][0]
        self.assertEqual(frame["id"], "1:100")
        self.assertNotIn("children", frame)

        res = fetch_nodes("KEY", ["1:100", "1:300"], "tok")
        self.assertIn("children", res["nodes"]["1:100"]["document"])
        self.assertEqual(len(res["nodes"]["1:100"]["document"]["children"]), 2)

        whole = fetch_whole_file("KEY", "tok")
        self.assertEqual(whole["document"], MOCK_FILE["document"])


class TestReconstruct(unittest.TestCase):
    def setUp(self):
        self._orig = client_mod._http["fetch"]
        client_mod._http["fetch"] = make_mock_fetch()

    def tearDown(self):
        client_mod._http["fetch"] = self._orig

    def test_lossless(self):
        depth = 2
        skel = fetch_skeleton("KEY", "tok", depth=depth)
        ids = collect_frontier_ids(skel, depth)
        parts = [fetch_nodes("KEY", g, "tok") for g in batch(ids, 2)]
        result = reconstruct(skel, index_parts(parts), ids)
        self.assertEqual(result["stats"]["grafted"], 3)
        self.assertEqual(result["stats"]["missing"], [])
        self.assertEqual(result["file"]["document"], MOCK_FILE["document"])

    def test_missing_not_dropped(self):
        skel = {"document": {"id": "0:0", "type": "DOCUMENT", "children": [{"id": "0:1", "type": "CANVAS", "children": [{"id": "1:1", "type": "FRAME"}]}]}}
        result = reconstruct(skel, index_parts([]), ["1:1"])
        self.assertEqual(result["stats"]["missing"], ["1:1"])
        self.assertEqual(result["stats"]["grafted"], 0)
        self.assertEqual(result["file"]["document"]["children"][0]["children"][0]["id"], "1:1")


class TestCli(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="figdl-py-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_mock_end_to_end(self):
        out = os.path.join(self.dir, "full.json")
        code = run(["--mock", "--work-dir", self.dir, "--out", out, "--keep-parts", "--quiet"])
        self.assertEqual(code, 0)
        full = json.load(open(out, encoding="utf-8"))
        self.assertEqual(full["document"], MOCK_FILE["document"])
        manifest = json.load(open(os.path.join(self.dir, "manifest.json"), encoding="utf-8"))
        self.assertEqual(manifest["frontierDepth"], 2)
        self.assertEqual(manifest["idCount"], 3)
        self.assertEqual(manifest["size"], "md")
        for p in manifest["parts"]:
            self.assertRegex(p["file"], r"^part-[0-9a-f]{12}\.json$")

    def test_size_sm_whole_path(self):
        code = run(["--mock", "--size", "sm", "--work-dir", self.dir, "--quiet"])
        self.assertEqual(code, 0)
        full = json.load(open(os.path.join(self.dir, "full.json"), encoding="utf-8"))
        self.assertEqual(full["document"], MOCK_FILE["document"])
        manifest = json.load(open(os.path.join(self.dir, "manifest.json"), encoding="utf-8"))
        self.assertEqual(manifest["size"], "sm")
        self.assertEqual(manifest["mode"], "whole")
        self.assertFalse(os.path.exists(os.path.join(self.dir, "parts")))

    def test_reconstruct_only(self):
        run(["--mock", "--work-dir", self.dir, "--keep-parts", "--quiet"])
        os.remove(os.path.join(self.dir, "full.json"))
        code = run(["--reconstruct-only", "--work-dir", self.dir, "--quiet"])
        self.assertEqual(code, 0)
        full = json.load(open(os.path.join(self.dir, "full.json"), encoding="utf-8"))
        self.assertEqual(full["document"], MOCK_FILE["document"])

    def test_resume_skips_groups(self):
        run(["--mock", "--work-dir", self.dir, "--keep-parts", "--quiet"])
        code = run(["--mock", "--work-dir", self.dir, "--keep-parts", "--resume", "--quiet"])
        self.assertEqual(code, 0)
        manifest = json.load(open(os.path.join(self.dir, "manifest.json"), encoding="utf-8"))
        self.assertGreaterEqual(manifest["resumedSkipped"], 1)


class TestTransport(unittest.TestCase):
    def test_direct_get(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("x-echo-path", self.path)
                self.end_headers()
                self.wfile.write(json.dumps({"hello": "world", "url": self.path}).encode())

            def log_message(self, *a):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        try:
            f = make_fetch()
            res = f(f"http://127.0.0.1:{port}/files/KEY?depth=2", headers={"X-Figma-Token": "t"})
            self.assertTrue(res.ok)
            self.assertEqual(res.status, 200)
            self.assertEqual(res.header("x-echo-path"), "/files/KEY?depth=2")
            self.assertEqual(res.json(), {"hello": "world", "url": "/files/KEY?depth=2"})
        finally:
            server.shutdown()

    def test_redact_proxy(self):
        self.assertEqual(redact_proxy("http://****:*****@host:8080"), "http://***@host:8080")
        self.assertEqual(redact_proxy("http://host:8080"), "http://host:8080")
        self.assertEqual(redact_proxy(""), "")


if __name__ == "__main__":
    unittest.main()
