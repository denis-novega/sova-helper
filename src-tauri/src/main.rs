#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::Context;
use include_dir::{include_dir, Dir, DirEntry};
use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

// ------------- Вшитые ресурсы -------------
static EMBED_BACKEND: Dir = include_dir!("$CARGO_MANIFEST_DIR/resources/backend");

struct BackendProc(Mutex<Option<Child>>);

// ------------- Утилиты логирования -------------
fn data_root() -> PathBuf {
    // App runtime artifacts are stored in the OS user data directory.
    let mut p = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    p.push("Sova");
    let _ = fs::create_dir_all(&p);
    p
}

fn path_bootstrap_log() -> PathBuf {
    data_root().join("bootstrap.log")
}

fn append_line(path: &Path, s: &str) {
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", s);
    }
}

// ------------- Распаковка вшитых файлов -------------
fn write_entry(dst_dir: &Path, entry: &DirEntry) -> anyhow::Result<()> {
    match entry {
        DirEntry::Dir(d) => {
            let sub = dst_dir.join(d.path());
            fs::create_dir_all(&sub)?;
            for e in d.entries() {
                write_entry(dst_dir, e)?;
            }
        }
        DirEntry::File(f) => {
            let dst = dst_dir.join(f.path());
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut src = f.contents();
            // если файл уже существует с тем же размером — не перезаписываем
            let write_needed = fs::metadata(&dst)
                .map(|m| m.len() != src.len() as u64)
                .unwrap_or(true);
            if write_needed {
                let mut out = fs::File::create(&dst)?;
                out.write_all(src)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn ensure_backend_extracted() -> anyhow::Result<PathBuf> {
    let target = data_root().join("backend"); // <- сюда распаковываем
    write_entry(&target, &EMBED_BACKEND.root())?;
    Ok(target)
}

// ------------- Ожидание порта -------------
fn wait_for_port(addr: &str, timeout_ms: u64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() < deadline {
        if TcpStream::connect(addr).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

// ------------- Старт / килл бэкенда -------------
fn start_backend() -> anyhow::Result<Child> {
    let log_boot = path_bootstrap_log();

    let backend_dir = ensure_backend_extracted()
        .context("failed to extract embedded backend")?;
    append_line(&log_boot, &format!("[extract] {}", backend_dir.display()));

    let script = backend_dir.join("run_backend.bat");
    if !script.exists() {
        anyhow::bail!("run_backend.bat not found at {}", script.display());
    }
    append_line(&log_boot, &format!("[spawn] {}", script.display()));

    // Тихий запуск .bat
    let child = Command::new("cmd")
        .args(["/C", &script.to_string_lossy()])
        .current_dir(&backend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed to spawn run_backend.bat")?;

    Ok(child)
}

fn kill_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BackendProc>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(BackendProc(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: Some("Sova.log".into()) }),
                    Target::new(TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // 1) стартуем бекенд
            match start_backend() {
                Ok(child) => {
                    let state = app.state::<BackendProc>();
                    *state.0.lock().unwrap() = Some(child);
                    log::info!("Backend spawned, waiting port 127.0.0.1:7861...");
                    append_line(&path_bootstrap_log(), "[spawned]");
                }
                Err(err) => {
                    log::error!("Failed to start backend: {err:#}");
                    append_line(&path_bootstrap_log(), &format!("[spawn-error] {err:#}"));
                }
            }

            // 2) ждём порт
            let up = wait_for_port("127.0.0.1:7861", 25_000);
            if up {
                log::info!("Backend is up on 127.0.0.1:7861");
                append_line(&path_bootstrap_log(), "[ready]");
            } else {
                log::error!("Backend did not open 127.0.0.1:7861");
                append_line(&path_bootstrap_log(), "[not-ready]");
            }

            Ok(())
        })
        .on_exit(|app, _| {
            kill_backend(app);
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                kill_backend(&window.app_handle());
                api.accept();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
