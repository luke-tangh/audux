import hashlib
from pathlib import Path

import pytest

from app.scanner import (
    SAMPLED_HASH_PREFIX,
    _collect_audio_candidates,
    _is_sampled_hash,
    _path_points_to_available_file,
    _same_audio_path,
    calculate_file_fingerprint,
    calculate_file_hash,
    calculate_sampled_file_hash,
)


class TestScannerHashing:
    @pytest.fixture(autouse=True)
    def set_root(self, tmp_path: Path):
        self.root = tmp_path

    def write_file(self, relative_path: str, data: bytes) -> Path:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_calculate_file_hash_matches_sha256(self):
        path = self.write_file("audio.mp3", b"hello world")

        expected = hashlib.sha256(b"hello world").hexdigest()

        assert calculate_file_hash(path) == expected

    def test_calculate_sampled_file_hash_has_prefix_and_is_deterministic(self):
        path = self.write_file("audio.mp3", b"abc" * 1024)

        first = calculate_sampled_file_hash(path)
        second = calculate_sampled_file_hash(path)

        assert first.startswith(SAMPLED_HASH_PREFIX)
        assert first == second
        assert _is_sampled_hash(first)

    def test_calculate_sampled_file_hash_changes_when_content_changes(self):
        path = self.write_file("audio.mp3", b"a" * 4096)
        before = calculate_sampled_file_hash(path)

        path.write_bytes(b"b" * 4096)
        after = calculate_sampled_file_hash(path)

        assert before != after

    def test_calculate_file_fingerprint_strategy_selection(self):
        path = self.write_file("audio.mp3", b"hello")

        full = calculate_file_fingerprint(path, strategy="full")
        sampled = calculate_file_fingerprint(path, strategy="sampled")
        unknown = calculate_file_fingerprint(path, strategy="unknown")

        assert full == hashlib.sha256(b"hello").hexdigest()
        assert sampled.startswith(SAMPLED_HASH_PREFIX)
        assert unknown == sampled

    def test_collect_audio_candidates_filters_supported_extensions(self):
        self.write_file("a.mp3", b"1")
        self.write_file("b.M4A", b"2")
        self.write_file("nested/c.FlAc", b"3")
        self.write_file("ignore.txt", b"4")
        self.write_file("image.jpg", b"5")

        found = _collect_audio_candidates(self.root)
        names = {p.name for p in found}

        assert names == {"a.mp3", "b.M4A", "c.FlAc"}

    def test_path_points_to_available_file(self):
        file_path = self.write_file("audio.mp3", b"1")
        missing_path = self.root / "missing.mp3"

        assert _path_points_to_available_file(str(file_path))
        assert not _path_points_to_available_file(str(self.root))
        assert not _path_points_to_available_file(str(missing_path))

    def test_same_audio_path(self):
        file_path = self.write_file("audio.mp3", b"1")

        assert _same_audio_path(str(file_path), str(file_path.resolve()))
        assert not _same_audio_path(str(file_path), str(self.root / "other.mp3"))
