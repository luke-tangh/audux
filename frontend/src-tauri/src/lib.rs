use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(any(debug_assertions, test))]
use std::io;
#[cfg(any(debug_assertions, test))]
use std::process::Child;

use tauri::{Emitter, Manager};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const BACKEND_API_HOST: &str = "127.0.0.1";
const BACKEND_PORT_ENV: &str = "AUDUX_API_PORT";
const BACKEND_PORT_FILE_ENV: &str = "AUDUX_API_PORT_FILE";
#[cfg(debug_assertions)]
const ALLOWED_ORIGINS_ENV: &str = "AUDUX_ALLOWED_ORIGINS";
#[cfg(debug_assertions)]
const DEV_FRONTEND_ORIGIN: &str = "http://127.0.0.1:5173";

#[cfg(debug_assertions)]
struct BackendProcess(Mutex<Option<std::process::Child>>);

struct BackendConfig {
    port_file: PathBuf,
}

#[derive(Default)]
struct ApplicationCloseState {
    dirty: AtomicBool,
    confirmed: AtomicBool,
}

#[cfg(not(debug_assertions))]
struct BackendSidecarProcess(Mutex<Option<CommandChild>>);

impl BackendConfig {
    fn new() -> Self {
        Self {
            port_file: std::env::temp_dir()
                .join(format!("audux-backend-{}.port", std::process::id())),
        }
    }
}

fn read_backend_base_url(path: &Path) -> Result<String, String> {
    let raw =
        fs::read_to_string(path).map_err(|error| format!("Backend port is not ready: {error}"))?;
    let port = raw
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or_else(|| "Backend published an invalid port".to_string())?;
    Ok(format!("http://{BACKEND_API_HOST}:{port}"))
}

fn wait_for_backend_base_url(path: &Path, timeout: Duration) -> Result<String, String> {
    let started = Instant::now();
    loop {
        if let Ok(base_url) = read_backend_base_url(path) {
            return Ok(base_url);
        }
        if started.elapsed() >= timeout {
            return Err("Timed out waiting for the backend port".to_string());
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn should_prevent_application_close(state: &ApplicationCloseState) -> bool {
    state.dirty.load(Ordering::SeqCst) && !state.confirmed.load(Ordering::SeqCst)
}

fn updater_config_is_ready(config: Option<&serde_json::Value>) -> bool {
    let Some(config) = config else {
        return false;
    };
    let has_pubkey = config
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let has_endpoint = config
        .get("endpoints")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|values| !values.is_empty());
    has_pubkey && has_endpoint
}

#[tauri::command]
fn application_updater_configured(app: tauri::AppHandle) -> bool {
    updater_config_is_ready(app.config().plugins.0.get("updater"))
}

#[cfg(any(debug_assertions, test))]
fn terminate_std_child(child: &mut Child) -> io::Result<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }

    match child.kill() {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => {}
        Err(error) => return Err(error),
    }

    child.wait().map(|_| ())
}

#[tauri::command]
async fn pick_audio_folder(window: tauri::Window) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let dialog = window.dialog().file();
    // Binding the Common Item Dialog to the WebView window can prevent it from
    // appearing during the first Windows launch. macOS still needs an explicit
    // parent so the picker is presented as a sheet for this window.
    #[cfg(target_os = "macos")]
    let dialog = dialog.set_parent(&window);
    let folder = dialog.blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn pick_audio_file(window: tauri::Window) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let dialog = window
        .dialog()
        .file()
        .add_filter("Audio", &["mp3", "m4a", "flac", "wav", "ogg"]);
    #[cfg(target_os = "macos")]
    let dialog = dialog.set_parent(&window);
    let file = dialog.blocking_pick_file();

    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
async fn backend_base_url(app: tauri::AppHandle) -> Result<String, String> {
    let port_file = app.state::<BackendConfig>().port_file.clone();
    tauri::async_runtime::spawn_blocking(move || {
        wait_for_backend_base_url(&port_file, Duration::from_secs(15))
    })
    .await
    .map_err(|error| format!("Failed to wait for backend startup: {error}"))?
}

#[tauri::command]
fn confirm_application_close(
    window: tauri::Window,
    state: tauri::State<'_, ApplicationCloseState>,
) -> Result<(), String> {
    state.confirmed.store(true, Ordering::SeqCst);
    if let Err(error) = window.close() {
        state.confirmed.store(false, Ordering::SeqCst);
        return Err(format!("Failed to close application window: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn set_application_close_guard(state: tauri::State<'_, ApplicationCloseState>, enabled: bool) {
    state.dirty.store(enabled, Ordering::SeqCst);
    if enabled {
        state.confirmed.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
fn restart_application(app: tauri::AppHandle) {
    stop_backend_sidecar(&app);
    app.restart();
}

fn audux_data_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve the user home directory".to_string())?;
    Ok(home.join(".audux"))
}

fn open_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open {}: {error}", path.display()))
}

#[tauri::command]
fn open_app_data_directory() -> Result<(), String> {
    open_directory(&audux_data_dir()?)
}

#[tauri::command]
fn open_logs_directory() -> Result<(), String> {
    open_directory(&audux_data_dir()?.join("logs"))
}

fn start_backend_sidecar(app: &tauri::AppHandle) {
    let config = app.state::<BackendConfig>();

    let _ = fs::remove_file(&config.port_file);
    // The backend binds port 0 itself and atomically publishes the selected
    // port. Keeping the listener in the backend removes the check/bind race.
    std::env::set_var(BACKEND_PORT_ENV, "0");
    std::env::set_var(BACKEND_PORT_FILE_ENV, &config.port_file);
    #[cfg(debug_assertions)]
    std::env::set_var(ALLOWED_ORIGINS_ENV, DEV_FRONTEND_ORIGIN);

    println!("Backend port file: {}", config.port_file.display());

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
            match terminate_std_child(&mut child) {
                Ok(()) => println!("Python backend process stopped."),
                Err(e) => eprintln!("Failed to stop Python backend process: {}", e),
            }
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

        if let Some(child) = guard.take() {
            let _ = child.kill();
            println!("Backend sidecar stopped.");
        }
    }

    let config = app.state::<BackendConfig>();
    if let Err(error) = fs::remove_file(&config.port_file) {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!("Failed to remove backend port file: {error}");
        }
    }
}

#[cfg(debug_assertions)]
fn find_dev_python() -> std::path::PathBuf {
    use std::env;
    use std::path::PathBuf;

    if let Ok(value) = env::var("AUDUX_PYTHON") {
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

    let result = shell.sidecar("audux-backend");

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
        .manage(ApplicationCloseState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(debug_assertions)]
    let builder = builder.manage(BackendProcess(Mutex::new(None)));

    #[cfg(not(debug_assertions))]
    let builder = builder.manage(BackendSidecarProcess(Mutex::new(None)));

    let app = builder
        .invoke_handler(tauri::generate_handler![
            pick_audio_folder,
            pick_audio_file,
            backend_base_url,
            confirm_application_close,
            set_application_close_guard,
            application_updater_configured,
            restart_application,
            open_app_data_directory,
            open_logs_directory
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            start_backend_sidecar(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let handle = window.app_handle();
                let state = handle.state::<ApplicationCloseState>();
                if should_prevent_application_close(&state) {
                    api.prevent_close();
                    if let Err(error) = window.emit("audux://close-requested", ()) {
                        eprintln!("Failed to request frontend close confirmation: {error}");
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Exit => stop_backend_sidecar(app_handle),
        tauri::RunEvent::ExitRequested { api, .. } => {
            let state = app_handle.state::<ApplicationCloseState>();
            if should_prevent_application_close(&state) {
                api.prevent_exit();
                if let Some(window) = app_handle.get_webview_window("main") {
                    if let Err(error) = window.emit("audux://close-requested", ()) {
                        eprintln!("Failed to request frontend exit confirmation: {error}");
                    }
                }
            } else {
                stop_backend_sidecar(app_handle);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{
        read_backend_base_url, should_prevent_application_close, terminate_std_child,
        updater_config_is_ready, ApplicationCloseState,
    };
    use std::fs;
    use std::process::{Command, Stdio};
    use std::sync::atomic::Ordering;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn base_updater_config_is_deserializable() {
        let tauri_config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater_config = tauri_config
            .pointer("/plugins/updater")
            .cloned()
            .expect("base updater config must exist");

        let updater: tauri_plugin_updater::Config = serde_json::from_value(updater_config).unwrap();
        assert!(updater.endpoints.is_empty());
        assert!(updater.pubkey.is_empty());
        assert!(!updater_config_is_ready(
            tauri_config.pointer("/plugins/updater")
        ));
    }

    #[test]
    fn backend_base_url_uses_the_atomically_published_port() {
        let path =
            std::env::temp_dir().join(format!("audux-port-test-{}.port", std::process::id()));
        fs::write(&path, "49152").unwrap();
        assert_eq!(
            read_backend_base_url(&path).unwrap(),
            "http://127.0.0.1:49152"
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn application_close_requires_frontend_confirmation() {
        let state = ApplicationCloseState::default();
        assert!(!should_prevent_application_close(&state));
        state.dirty.store(true, Ordering::SeqCst);
        assert!(should_prevent_application_close(&state));
        state.confirmed.store(true, Ordering::SeqCst);
        assert!(!should_prevent_application_close(&state));
    }

    #[test]
    fn spawned_backend_process_is_stopped_and_reaped() {
        let test_executable = std::env::current_exe().unwrap();
        let mut child = Command::new(test_executable)
            .args([
                "--exact",
                "tests::backend_child_helper",
                "--ignored",
                "--nocapture",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        thread::sleep(Duration::from_millis(100));
        assert!(child.try_wait().unwrap().is_none());

        terminate_std_child(&mut child).unwrap();
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    #[ignore = "helper process for spawned_backend_process_is_stopped_and_reaped"]
    fn backend_child_helper() {
        thread::sleep(Duration::from_secs(30));
    }
}
