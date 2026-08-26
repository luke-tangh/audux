use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const SIDECAR_BASENAME: &str = "audux-backend";
const DEV_PLACEHOLDER_MARKER: &[u8] = b"AUDUX_DEV_SIDECAR_PLACEHOLDER\n";
const DEV_NOTICES_MARKER: &[u8] = b"AUDUX_DEV_THIRD_PARTY_NOTICES_PLACEHOLDER\n";

fn target_sidecar_path() -> Option<PathBuf> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").ok()?;
    let target = env::var("TARGET").ok()?;

    if target.trim().is_empty() {
        return None;
    }

    let exe_suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };

    Some(
        PathBuf::from(manifest_dir)
            .join("binaries")
            .join(format!("{SIDECAR_BASENAME}-{target}{exe_suffix}")),
    )
}

fn file_starts_with(path: &Path, prefix: &[u8]) -> bool {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };

    let mut buf = vec![0_u8; prefix.len()];

    match file.read_exact(&mut buf) {
        Ok(_) => buf == prefix,
        Err(_) => false,
    }
}

fn ensure_dev_sidecar_placeholder() {
    let profile = env::var("PROFILE").unwrap_or_default();

    let Some(path) = target_sidecar_path() else {
        return;
    };

    println!("cargo:rerun-if-changed={}", path.display());

    if profile == "release" {
        if !path.exists() {
            panic!(
                "\nRelease sidecar is missing:\n  {}\n\n\
                 Build it for the current platform before compiling Tauri directly:\n\
                 cd frontend && npm run build:backend\n\n\
                 `npm run tauri:build` performs this step automatically.\n",
                path.display()
            );
        }

        if file_starts_with(&path, DEV_PLACEHOLDER_MARKER) {
            panic!(
                "\nRelease sidecar is still a dev placeholder:\n  {}\n\n\
                 Please build the real backend sidecar before running `tauri build`:\n\
                 cd frontend && npm run build:backend\n",
                path.display()
            );
        }

        ensure_unix_executable(&path);
        return;
    }

    if profile != "debug" {
        return;
    }

    if path.exists() {
        return;
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("failed to create src-tauri/binaries directory");
    }

    let content = [
        DEV_PLACEHOLDER_MARKER,
        b"This file is generated only for `tauri dev`.\n",
        b"The dev build starts the Python backend from backend/run.py directly.\n",
        b"Do not ship this file in release builds.\n",
    ]
    .concat();

    fs::write(&path, content).expect("failed to create dev sidecar placeholder");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if let Ok(metadata) = fs::metadata(&path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o755);
            let _ = fs::set_permissions(&path, permissions);
        }
    }

    println!(
        "cargo:warning=Created dev sidecar placeholder: {}",
        path.display()
    );
}

fn ensure_bundle_license_resources() {
    let profile = env::var("PROFILE").unwrap_or_default();
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is required"));
    let resources_dir = manifest_dir.join("build-resources");
    let license_path = resources_dir.join("LICENSE");
    let notices_path = resources_dir.join("THIRD_PARTY_NOTICES.txt");

    println!("cargo:rerun-if-changed={}", license_path.display());
    println!("cargo:rerun-if-changed={}", notices_path.display());

    if profile == "release" {
        if !license_path.is_file()
            || !notices_path.is_file()
            || file_starts_with(&notices_path, DEV_NOTICES_MARKER)
        {
            panic!(
                "\nRelease license resources are missing or still placeholders.\n\
                 Build through `cd frontend && npm run tauri:build`; the backend build\n\
                 step generates LICENSE and THIRD_PARTY_NOTICES.txt before bundling.\n"
            );
        }
        return;
    }

    fs::create_dir_all(&resources_dir)
        .expect("failed to create src-tauri/build-resources directory");
    if !license_path.is_file() {
        fs::copy(manifest_dir.join("../../LICENSE"), &license_path)
            .expect("failed to prepare development LICENSE resource");
    }
    if !notices_path.is_file() {
        fs::write(
            &notices_path,
            [
                DEV_NOTICES_MARKER,
                b"Development-only placeholder; public release builds must replace this file.\n",
            ]
            .concat(),
        )
        .expect("failed to prepare development third-party notices resource");
    }
}

#[cfg(unix)]
fn ensure_unix_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        let mode = permissions.mode();

        if mode & 0o111 == 0 {
            permissions.set_mode(mode | 0o111);
            fs::set_permissions(path, permissions)
                .expect("failed to make backend sidecar executable");
        }
    }
}

#[cfg(not(unix))]
fn ensure_unix_executable(_path: &Path) {}

fn main() {
    println!("cargo:rerun-if-env-changed=PROFILE");
    println!("cargo:rerun-if-env-changed=TARGET");

    ensure_dev_sidecar_placeholder();
    ensure_bundle_license_resources();

    tauri_build::build();
}
