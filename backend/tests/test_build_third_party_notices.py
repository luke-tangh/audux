from build_third_party_notices import PackageNotice, render_notices


def test_render_notices_is_deterministic_and_deduplicates_license_texts() -> None:
    packages = [
        PackageNotice("npm", "zeta", "2.0", "MIT", ("shared license",)),
        PackageNotice("Python", "Alpha", "1.0", "MIT", ("shared license",)),
        PackageNotice("Cargo", "missing", "3.0", "Apache-2.0", ()),
    ]

    rendered = render_notices(packages)

    assert rendered.index("[Cargo] missing") < rendered.index("[npm] zeta")
    assert rendered.index("[npm] zeta") < rendered.index("[Python] Alpha")
    assert rendered.count("shared license") == 1
    assert "PACKAGES WITHOUT A BUNDLED LICENSE FILE" in rendered
    assert "[Cargo] missing 3.0" in rendered
