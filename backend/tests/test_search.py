import unittest

from app.search import _build_safe_fts5_query


class TestSearchQueryBuilder(unittest.TestCase):
    def test_build_safe_fts5_query_single_token(self):
        self.assertEqual(_build_safe_fts5_query("线性代数"), '"线性代数"')

    def test_build_safe_fts5_query_multiple_tokens(self):
        self.assertEqual(_build_safe_fts5_query("foo bar"), '"foo" AND "bar"')

    def test_build_safe_fts5_query_escapes_quotes(self):
        self.assertEqual(_build_safe_fts5_query('foo "bar"'), '"foo" AND """bar"""')

    def test_build_safe_fts5_query_empty(self):
        self.assertEqual(_build_safe_fts5_query("   "), "")


if __name__ == "__main__":
    unittest.main()
