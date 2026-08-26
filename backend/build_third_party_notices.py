import argparse
import importlib.metadata
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
TAURI_ROOT = FRONTEND_ROOT / "src-tauri"
MAX_LICENSE_BYTES = 1024 * 1024
LICENSE_PREFIXES = ("license", "licence", "copying", "notice")


@dataclass(frozen=True)
class PackageNotice:
    ecosystem: str
    name: str
    version: str
    declared_license: str
    license_texts: tuple[str, ...]


def _is_license_name(name: str) -> bool:
    return name.lower().startswith(LICENSE_PREFIXES)


def _read_license(path: Path) -> str | None:
    try:
        if not path.is_file() or path.stat().st_size > MAX_LICENSE_BYTES:
            return None
        text = path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    return text or None


def _declared_license(value: object) -> str:
    declared = str(value or "").strip()
    if not declared:
        return "Not declared in package metadata"
    if "\n" in declared or len(declared) > 200:
        return "See bundled license text"
    return declared


def python_notices() -> list[PackageNotice]:
    notices: list[PackageNotice] = []
    for distribution in importlib.metadata.distributions():
        metadata = distribution.metadata
        name = metadata.get("Name", "").strip()
        version = metadata.get("Version", "").strip()
        if not name or name.lower() == "audux":
            continue
        license_names = set(metadata.get_all("License-File") or [])
        license_names.update(
            str(item) for item in (distribution.files or []) if _is_license_name(item.name)
        )
        texts = {
            text
            for relative in license_names
            if (text := _read_license(Path(distribution.locate_file(relative))))
        }
        declared = _declared_license(
            metadata.get("License-Expression")
            or metadata.get("License")
        )
        notices.append(
            PackageNotice("Python", name, version, declared, tuple(sorted(texts)))
        )
    return notices


def npm_notices() -> list[PackageNotice]:
    lock_path = FRONTEND_ROOT / "package-lock.json"
    node_modules = FRONTEND_ROOT / "node_modules"
    if not lock_path.is_file() or not node_modules.is_dir():
        raise RuntimeError("npm dependencies are missing; run `cd frontend && npm ci`")

    packages = json.loads(lock_path.read_text(encoding="utf-8")).get("packages", {})
    notices: list[PackageNotice] = []
    for package_path, package in packages.items():
        prefix = "node_modules/"
        if not package_path.startswith(prefix) or package.get("dev") is True:
            continue
        name = package_path[len(prefix) :]
        package_dir = FRONTEND_ROOT / package_path
        if not package_dir.is_dir():
            continue
        package_json_path = package_dir / "package.json"
        package_json = (
            json.loads(package_json_path.read_text(encoding="utf-8"))
            if package_json_path.is_file()
            else {}
        )
        texts = {
            text
            for child in package_dir.iterdir()
            if _is_license_name(child.name) and (text := _read_license(child))
        }
        declared = _declared_license(
            package_json.get("license")
            or package.get("license")
        )
        notices.append(
            PackageNotice(
                "npm",
                str(package_json.get("name") or name),
                str(package_json.get("version") or package.get("version") or "unknown"),
                declared,
                tuple(sorted(texts)),
            )
        )
    return notices


def cargo_notices() -> list[PackageNotice]:
    target = os.getenv("TAURI_ENV_TARGET_TRIPLE", "").strip()
    if not target:
        rustc = subprocess.run(
            ["rustc", "-vV"],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        target = next(
            (
                line.removeprefix("host: ").strip()
                for line in rustc.stdout.splitlines()
                if line.startswith("host: ")
            ),
            "",
        )
    if not target:
        raise RuntimeError("Could not determine the Cargo target triple for notices")

    result = subprocess.run(
        [
            "cargo",
            "metadata",
            "--locked",
            "--format-version",
            "1",
            "--filter-platform",
            target,
        ],
        cwd=TAURI_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode:
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else ""
        raise RuntimeError(f"Cargo metadata failed for {target}: {detail}")
    metadata = json.loads(result.stdout)
    workspace_members = set(metadata.get("workspace_members", []))
    notices: list[PackageNotice] = []
    for package in metadata.get("packages", []):
        if package.get("id") in workspace_members:
            continue
        package_dir = Path(package["manifest_path"]).parent
        explicit_license = package.get("license_file")
        texts = {
            text
            for child in package_dir.iterdir()
            if _is_license_name(child.name) and (text := _read_license(child))
        }
        if explicit_license and (
            text := _read_license(package_dir / explicit_license)
        ):
            texts.add(text)
        notices.append(
            PackageNotice(
                "Cargo",
                package["name"],
                package["version"],
                _declared_license(
                    package.get("license") or package.get("license_file")
                ),
                tuple(sorted(texts)),
            )
        )
    return notices


def render_notices(packages: list[PackageNotice]) -> str:
    ordered = sorted(
        packages,
        key=lambda item: (item.ecosystem.lower(), item.name.lower(), item.version),
    )
    lines = [
        "AUDUX THIRD-PARTY SOFTWARE NOTICES",
        "==================================",
        "",
        "This file lists runtime dependencies included in this distribution and",
        "reproduces the license or notice texts supplied by those dependencies.",
        "",
        "DEPENDENCY INDEX",
        "----------------",
    ]
    for package in ordered:
        lines.append(
            f"- [{package.ecosystem}] {package.name} {package.version}: "
            f"{package.declared_license}"
        )

    text_owners: dict[str, list[str]] = {}
    missing: list[str] = []
    for package in ordered:
        label = f"[{package.ecosystem}] {package.name} {package.version}"
        if not package.license_texts:
            missing.append(label)
        for license_text in package.license_texts:
            text_owners.setdefault(license_text, []).append(label)

    if missing:
        lines.extend(
            [
                "",
                "PACKAGES WITHOUT A BUNDLED LICENSE FILE",
                "---------------------------------------",
                "The package metadata declaration above remains authoritative for:",
                *[f"- {label}" for label in missing],
            ]
        )

    lines.extend(["", "LICENSE AND NOTICE TEXTS", "------------------------"])
    for index, (license_text, owners) in enumerate(
        sorted(text_owners.items(), key=lambda item: (item[1][0].lower(), item[0])),
        start=1,
    ):
        lines.extend(
            [
                "",
                f"Notice text {index}",
                "Applies to: " + ", ".join(sorted(owners, key=str.lower)),
                "",
                license_text,
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def build_notices(
    output: Path,
    *,
    include_python: bool,
    include_npm: bool,
    include_cargo: bool,
) -> Path:
    packages: list[PackageNotice] = []
    selected = []
    for name, enabled, collector in (
        ("Python", include_python, python_notices),
        ("npm", include_npm, npm_notices),
        ("Cargo", include_cargo, cargo_notices),
    ):
        if enabled:
            collected = collector()
            if not collected:
                raise RuntimeError(f"No {name} dependencies were found for notices")
            packages.extend(collected)
            selected.append(name)
    if not selected:
        raise RuntimeError("At least one dependency ecosystem must be selected")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_notices(packages), encoding="utf-8")
    print(f"Third-party notices ({', '.join(selected)}): {output}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Audux third-party notices.")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--python", action="store_true", dest="include_python")
    parser.add_argument("--npm", action="store_true", dest="include_npm")
    parser.add_argument("--cargo", action="store_true", dest="include_cargo")
    args = parser.parse_args()
    build_notices(
        args.output,
        include_python=args.include_python,
        include_npm=args.include_npm,
        include_cargo=args.include_cargo,
    )


if __name__ == "__main__":
    main()
