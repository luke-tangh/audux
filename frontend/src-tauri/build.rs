use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const SIDECAR_BASENAME: &str = "local-audio-backend";
const DEV_PLACEHOLDER_MARKER: &[u8] =
    b"LOCAL_AUDIO_LIBRARY_DEV_SIDECAR_PLACEHOLDER\n";

fn target_sidecar_path() -> Option<PathBuf> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").ok()?;
    let target = env::var("TARGET").ok()?;

    if target.trim().is_empty() {
        return None;
    }

    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };

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

    if profile == "release" {
        if path.exists() && file_starts_with(&path, DEV_PLACEHOLDER_MARKER) {
            panic!(
                "\nRelease sidecar is still a dev placeholder:\n  {}\n\n\
                 Please build the real backend sidecar before running `tauri build`:\n\
                 1. cd backend\n\
                 2. python build_backend.py\n\
                 3. cd ../frontend\n\
                 4. npm run tauri:build\n",
                path.display()
            );
        }

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

fn main() {
    println!("cargo:rerun-if-env-changed=PROFILE");
    println!("cargo:rerun-if-env-changed=TARGET");

    ensure_dev_sidecar_placeholder();

    tauri_build::build();
}
