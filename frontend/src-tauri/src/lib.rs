use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn pick_audio_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn backend_health() -> Result<bool, String> {
    // MVP 中前端会直接请求 http://127.0.0.1:8765/health
    // 这里保留一个 Tauri invoke 级别的健康检查占位。
    Ok(true)
}

fn start_backend_sidecar(app: &tauri::AppHandle) {
    let shell = app.shell();

    #[cfg(debug_assertions)]
    {
        // 开发模式：
        // 从 frontend/src-tauri 目录回到项目根目录，再找 backend/run.py。
        let backend_script = std::path::PathBuf::from("../../backend/run.py");

        // Windows / Linux / macOS 一般都可以先用 python。
        // 如果你的系统命令是 python3，请把这里改成 python3。
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
        // 生产模式：
        // 使用 Tauri sidecar 启动 PyInstaller 打包后的后端。
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
