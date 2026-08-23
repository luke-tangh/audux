import hashlib
from pathlib import Path

import pytest

from app import media_probe, scanner
from app.media_probe import (
    SAMPLED_HASH_PREFIX,
    calculate_file_fingerprint,
    calculate_file_hash,
    calculate_sampled_file_hash,
)
from app.scan_reconciler import _path_points_to_available_file, _same_audio_path
from app.scanner import _iter_audio_candidates


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

    def test_iter_audio_candidates_filters_supported_extensions(self):
        self.write_file("a.mp3", b"1")
        self.write_file("b.M4A", b"2")
        self.write_file("nested/c.FlAc", b"3")
        self.write_file("ignore.txt", b"4")
        self.write_file("image.jpg", b"5")

        found = list(_iter_audio_candidates(self.root))
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


class TestScannerMetadataAndCovers:
    def test_read_audio_metadata_normalizes_info_and_common_tags(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        class Info:
            length = 42.5
            bitrate = 192000
            sample_rate = 48000
            channels = 2

        class Audio:
            info = Info()
            tags = {
                "TIT2": ["Episode title"],
                "TPE1": "Speaker",
                "TALB": ["Series"],
                "COMM": "Summary",
            }

        monkeypatch.setattr(media_probe, "MutagenFile", lambda path: Audio())
        metadata = media_probe.read_audio_metadata(tmp_path / "episode.mp3")

        assert metadata == {
            "title_original": "Episode title",
            "author_original": "Speaker",
            "album_original": "Series",
            "description_original": "Summary",
            "duration_seconds": 42.5,
            "bitrate": 192000,
            "sample_rate": 48000,
            "channels": 2,
        }

    def test_read_audio_metadata_returns_defaults_on_parser_failure(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        def fail(path: str):
            raise ValueError(f"invalid media: {path}")

        monkeypatch.setattr(media_probe, "MutagenFile", fail)
        metadata = media_probe.read_audio_metadata(tmp_path / "broken.mp3")

        assert set(metadata.values()) == {None}

    def test_extract_embedded_cover_replaces_old_managed_cover(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        cover_dir = tmp_path / "covers"
        cover_dir.mkdir()
        old_cover = cover_dir / "audio_7.jpg"
        old_cover.write_bytes(b"old")

        class Picture:
            data = b"new-png-cover"
            mime = "image/png"

        class Audio:
            tags = {"APIC:front": Picture()}

        monkeypatch.setattr(media_probe, "COVERS_DIR", cover_dir)
        monkeypatch.setattr(media_probe, "MutagenFile", lambda path: Audio())

        extracted = media_probe.extract_embedded_cover(tmp_path / "audio.mp3", 7)
        expected_path = cover_dir / "audio_7.png"
        assert extracted == {
            "cover_path": str(expected_path),
            "cover_source": "embedded",
        }
        assert expected_path.read_bytes() == b"new-png-cover"
        assert not old_cover.exists()

    def test_cover_storage_rejects_empty_and_oversized_data(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.setattr(media_probe, "COVERS_DIR", tmp_path / "covers")
        monkeypatch.setattr(media_probe, "MAX_COVER_BYTES", 4)

        assert media_probe.save_cover_bytes(1, b"", "image/jpeg") is None
        assert media_probe.save_cover_bytes(1, b"12345", "image/jpeg") is None
        assert not (tmp_path / "covers").exists()
