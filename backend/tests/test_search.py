from app.search import (
    _build_safe_fts5_query,
    _escape_fts5_phrase,
    _escape_like_query,
)


class TestSearchQueryBuilder:
    def test_build_safe_fts5_query_single_token(self):
        assert _build_safe_fts5_query("线性代数") == '"线性代数"'

    def test_build_safe_fts5_query_multiple_tokens(self):
        assert _build_safe_fts5_query("foo bar") == '"foo" AND "bar"'

    def test_build_safe_fts5_query_escapes_quotes(self):
        assert _build_safe_fts5_query('foo "bar"') == '"foo" AND """bar"""'

    def test_build_safe_fts5_query_empty(self):
        assert _build_safe_fts5_query("   ") == ""

    def test_build_safe_fts5_query_handles_tabs_and_newlines(self):
        assert _build_safe_fts5_query(" foo\tbar \n baz ") == (
            '"foo" AND "bar" AND "baz"'
        )

    def test_build_safe_fts5_query_wraps_special_fts_syntax_as_phrases(self):
        assert _build_safe_fts5_query("title:foo -bar (baz)") == (
            '"title:foo" AND "-bar" AND "(baz)"'
        )

    def test_escape_fts5_phrase(self):
        assert _escape_fts5_phrase('a"b') == '"a""b"'

    def test_escape_like_query_escapes_wildcards_and_backslash(self):
        assert _escape_like_query(r"100%_ok\path") == r"100\%\_ok\\path"

    def test_escape_like_query_keeps_plain_text_unchanged(self):
        assert _escape_like_query("plain text") == "plain text"
