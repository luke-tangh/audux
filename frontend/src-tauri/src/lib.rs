use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<std::process::Child>>);

#[tauri::command]
async fn pick_audio_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn pick_audio_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Audio", &["mp3", "m4a", "flac", "wav", "ogg"])
        .blocking_pick_file();

    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
async fn backend_health() -> Result<bool, String> {
    Ok(true)
}

fn start_backend_sidecar(app: &tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        start_backend_in_dev(app);
    }

    #[cfg(not(debug_assertions))]
    {
        start_backend_in_release(app);
    }
}

#[cfg(debug_assertions)]
fn find_dev_python() -> std::path::PathBuf {
    use std::env;
    use std::path::PathBuf;

    if let Ok(value) = env::var("LOCAL_AUDIO_LIBRARY_PYTHON") {
        let value = value.trim();
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }

    if let Ok(venv) = env::var("VIRTUAL_ENV") {
        let python = if cfg!(windows) {
            PathBuf::from(venv).join("Scripts").join("python.exe")
        } else {
            PathBuf::from(venv).join("bin").join("python")
        };

        if python.exists() {
            return python;
        }
    }

    if cfg!(windows) {
        PathBuf::from("python")
    } else {
        PathBuf::from("python3")
    }
}

#[cfg(debug_assertions)]
fn start_backend_in_dev(app: &tauri::AppHandle) {
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    let state = app.state::<BackendProcess>();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(e) => {
            eprintln!("Failed to lock backend process state: {}", e);
            return;
        }
    };

    if guard.is_some() {
        println!("Python backend is already marked as started.");
        return;
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let backend_script_raw = manifest_dir.join("../../backend/run.py");

    let backend_script = backend_script_raw
        .canonicalize()
        .unwrap_or(backend_script_raw);

    let backend_dir = backend_script
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| manifest_dir.clone());

    let python = find_dev_python();

    println!("Starting FastAPI backend in dev mode...");
    println!("  python: {}", python.display());
    println!("  script: {}", backend_script.display());
    println!("  cwd: {}", backend_dir.display());

    let child = Command::new(&python)
        .arg(&backend_script)
        .current_dir(&backend_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn();

    match child {
        Ok(child) => {
            println!("Python backend process spawned.");
            *guard = Some(child);
        }
        Err(e) => {
            eprintln!("Failed to start Python backend in dev mode: {}", e);
            eprintln!();
            eprintln!("Try manually:");
            eprintln!("  {} {}", python.display(), backend_script.display());
            eprintln!();
            eprintln!("If dependencies are missing, run:");
            eprintln!(
                "  {} -m pip install fastapi uvicorn sqlmodel sqlalchemy mutagen httpx python-multipart",
                python.display()
            );
        }
    }
}

#[cfg(not(debug_assertions))]
fn start_backend_in_release(app: &tauri::AppHandle) {
    let shell = app.shell();

    let result = shell.sidecar("local-audio-backend");

    match result {
        Ok(cmd) => match cmd.spawn() {
            Ok((mut rx, child)) => {
                println!("Backend sidecar started.");

                tauri::async_runtime::spawn(async move {
                    let _child = child;

                    while let Some(event) = rx.recv().await {
                        println!("Backend sidecar event: {:?}", event);
                    }
                });
            }
            Err(e) => {
                eprintln!("Failed to spawn backend sidecar: {}", e);
            }
        },
        Err(e) => {
            eprintln!("Failed to create backend sidecar command: {}", e);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            pick_audio_folder,
            pick_audio_file,
            backend_health
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            start_backend_sidecar(&handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
