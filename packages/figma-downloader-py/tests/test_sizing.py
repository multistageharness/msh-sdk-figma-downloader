"""test_sizing.py — tier classification + strategy resolution."""

import unittest

from figma_downloader.sizing import MB, PRESETS, TIERS, classify, resolve_strategy


class TestSizing(unittest.TestCase):
    def test_small_truncation_free_is_sm(self):
        self.assertEqual(classify({"nodeCount": 100, "frontierWidth": 0, "skeletonBytes": 1000, "hasFrontier": False}), "sm")

    def test_scales_by_node_count(self):
        self.assertEqual(classify({"nodeCount": 10_000, "frontierWidth": 10, "skeletonBytes": 1000}), "md")
        self.assertEqual(classify({"nodeCount": 100_000, "frontierWidth": 10, "skeletonBytes": 1000}), "large")
        self.assertEqual(classify({"nodeCount": 500_000, "frontierWidth": 10, "skeletonBytes": 1000}), "xl")
        self.assertEqual(classify({"nodeCount": 5_000_000, "frontierWidth": 10, "skeletonBytes": 1000}), "xxxxl")

    def test_largest_signal_wins(self):
        self.assertEqual(classify({"nodeCount": 100, "frontierWidth": 5000, "skeletonBytes": 1000}), "xxxxl")
        self.assertIn(classify({"nodeCount": 100, "frontierWidth": 1, "skeletonBytes": 40 * MB}), ["large", "xl", "xxxxl"])

    def test_explicit_size_preset(self):
        s = resolve_strategy(size="xl")
        self.assertEqual(s["size"], "xl")
        self.assertEqual(s["depth"], PRESETS["xl"]["depth"])
        self.assertTrue(s["stream"])
        self.assertTrue(s["rechunk"])

    def test_explicit_cli_overrides_preset(self):
        s = resolve_strategy(size="md", depth=4, batch_size=1, concurrency=16, explicit={"depth": True, "batchSize": True, "concurrency": True})
        self.assertEqual(s["depth"], 4)
        self.assertEqual(s["batchSize"], 1)
        self.assertEqual(s["concurrency"], 16)

    def test_non_explicit_does_not_override(self):
        s = resolve_strategy(size="md", depth=4, explicit={"depth": False})
        self.assertEqual(s["depth"], PRESETS["md"]["depth"])

    def test_maxpartbytes_zero_disables_rechunk(self):
        s = resolve_strategy(size="xl", max_part_bytes=0)
        self.assertEqual(s["maxPartBytes"], 0)
        self.assertFalse(s["rechunk"])

    def test_auto_classification(self):
        s = resolve_strategy(signals={"nodeCount": 5_000_000, "frontierWidth": 10, "skeletonBytes": 1000})
        self.assertEqual(s["size"], "xxxxl")

    def test_tiers_presets_aligned(self):
        for t in TIERS:
            self.assertIn(t, PRESETS)


if __name__ == "__main__":
    unittest.main()
