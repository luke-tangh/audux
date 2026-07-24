import unittest

from app.search import (
    _build_safe_fts5_query,
    _escape_fts5_phrase,
    _escape_like_query,
)


class TestSearchQueryBuilder(unittest.TestCase):
    def test_build_safe_fts5_query_single_token(self):
        self.assertEqual(_build_safe_fts5_query("线性代数"), '"线性代数"')

    def test_build_safe_fts5_query_multiple_tokens(self):
        self.assertEqual(_build_safe_fts5_query("foo bar"), '"foo" AND "bar"')

    def test_build_safe_fts5_query_escapes_quotes(self):
        self.assertEqual(_build_safe_fts5_query('foo "bar"'), '"foo" AND """bar"""')

    def test_build_safe_fts5_query_empty(self):
        self.assertEqual(_build_safe_fts5_query("   "), "")

    def test_build_safe_fts5_query_handles_tabs_and_newlines(self):
        self.assertEqual(
            _build_safe_fts5_query(" foo\tbar \n baz "),
            '"foo" AND "bar" AND "baz"',
        )

    def test_build_safe_fts5_query_wraps_special_fts_syntax_as_phrases(self):
        self.assertEqual(
            _build_safe_fts5_query("title:foo -bar (baz)"),
            '"title:foo" AND "-bar" AND "(baz)"',
        )

    def test_escape_fts5_phrase(self):
        self.assertEqual(_escape_fts5_phrase('a"b'), '"a""b"')

    def test_escape_like_query_escapes_wildcards_and_backslash(self):
        self.assertEqual(
            _escape_like_query(r"100%_ok\path"),
            r"100\%\_ok\\path",
        )

    def test_escape_like_query_keeps_plain_text_unchanged(self):
        self.assertEqual(_escape_like_query("plain text"), "plain text")


if __name__ == "__main__":
    unittest.main()
