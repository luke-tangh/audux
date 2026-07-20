use tauri_plugin_shell::ShellExt;

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
    let shell = app.shell();

    #[cfg(debug_assertions)]
    {
        let backend_script = std::path::PathBuf::from("../../backend/run.py");

        let result = shell.command("python").arg(backend_script).spawn();

        match result {
            Ok((_rx, _child)) => {
                println!("Python backend started in dev mode.");
            }
            Err(e) => {
                eprintln!("Failed to start Python backend in dev mode: {}", e);
            }
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let result = shell.sidecar("local-audio-backend");

        match result {
            Ok(cmd) => match cmd.spawn() {
                Ok((_rx, _child)) => {
                    println!("Backend sidecar started.");
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
}

pub fn run() {
    tauri::Builder::default()
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
