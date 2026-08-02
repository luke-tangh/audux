use std::net::TcpListener;
use std::sync::Mutex;

use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const BACKEND_API_HOST: &str = "127.0.0.1";
const BACKEND_PORT_ENV: &str = "LOCAL_AUDIO_LIBRARY_API_PORT";
const DEFAULT_BACKEND_PORT: u16 = 8765;

struct BackendProcess(Mutex<Option<std::process::Child>>);

struct BackendConfig {
    port: u16,
    base_url: String,
}

#[cfg(not(debug_assertions))]
struct BackendSidecarProcess(Mutex<Option<CommandChild>>);

impl BackendConfig {
    fn new() -> Self {
        let port = choose_backend_port();

        Self {
            port,
            base_url: format!("http://{BACKEND_API_HOST}:{port}"),
        }
    }
}

fn requested_backend_port() -> u16 {
    std::env::var(BACKEND_PORT_ENV)
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_BACKEND_PORT)
}

fn is_port_available(port: u16) -> bool {
    TcpListener::bind((BACKEND_API_HOST, port)).is_ok()
}

fn random_available_port() -> Option<u16> {
    let listener = TcpListener::bind((BACKEND_API_HOST, 0)).ok()?;
    Some(listener.local_addr().ok()?.port())
}

fn choose_backend_port() -> u16 {
    let requested = requested_backend_port();

    if is_port_available(requested) {
        return requested;
    }

    random_available_port().unwrap_or(requested)
}

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

#[tauri::command]
async fn backend_base_url(app: tauri::AppHandle) -> Result<String, String> {
    let config = app.state::<BackendConfig>();
    Ok(config.base_url.clone())
}

fn start_backend_sidecar(app: &tauri::AppHandle) {
    let config = app.state::<BackendConfig>();

    // Child processes inherit the current process environment. This lets both
    // dev Python backend and release sidecar bind to the Tauri-selected port.
    std::env::set_var(BACKEND_PORT_ENV, config.port.to_string());

    println!("Backend API base URL: {}", config.base_url);

    #[cfg(debug_assertions)]
    {
        start_backend_in_dev(app);
    }

    #[cfg(not(debug_assertions))]
    {
        start_backend_in_release(app);
    }
}

fn stop_backend_sidecar(app: &tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        let state = app.state::<BackendProcess>();
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(e) => {
                eprintln!("Failed to lock backend process state: {}", e);
                return;
            }
        };

        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            println!("Python backend process stopped.");
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let state = app.state::<BackendSidecarProcess>();
        let mut guard = match state.0.lock() {
            Ok(guard) => guard,
            Err(e) => {
                eprintln!("Failed to lock backend sidecar state: {}", e);
                return;
            }
        };

        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            println!("Backend sidecar stopped.");
        }
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

    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let project_venv_python = if cfg!(windows) {
        project_root
            .join(".venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        project_root.join(".venv").join("bin").join("python")
    };

    if project_venv_python.exists() {
        return project_venv_python;
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
    println!(
        "  {}: {}",
        BACKEND_PORT_ENV,
        std::env::var(BACKEND_PORT_ENV).unwrap_or_default()
    );

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
            eprintln!("  uv sync");
        }
    }
}

#[cfg(not(debug_assertions))]
fn start_backend_in_release(app: &tauri::AppHandle) {
    let state = app.state::<BackendSidecarProcess>();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(e) => {
            eprintln!("Failed to lock backend sidecar state: {}", e);
            return;
        }
    };

    if guard.is_some() {
        println!("Backend sidecar is already marked as started.");
        return;
    }

    let shell = app.shell();

    let result = shell.sidecar("local-audio-backend");

    match result {
        Ok(cmd) => match cmd.spawn() {
            Ok((mut rx, child)) => {
                println!("Backend sidecar started.");
                *guard = Some(child);

                tauri::async_runtime::spawn(async move {
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
    let backend_config = BackendConfig::new();

    let builder = tauri::Builder::default()
        .manage(backend_config)
        .manage(BackendProcess(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(not(debug_assertions))]
    let builder = builder.manage(BackendSidecarProcess(Mutex::new(None)));

    builder
        .invoke_handler(tauri::generate_handler![
            pick_audio_folder,
            pick_audio_file,
            backend_health,
            backend_base_url
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            start_backend_sidecar(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let handle = window.app_handle();
                stop_backend_sidecar(&handle);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
