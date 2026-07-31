use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: Option<u64>,
}

#[cfg(windows)]
fn is_hidden(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    meta.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
}

#[tauri::command]
fn list_drives() -> Vec<String> {
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if Path::new(&root).exists() {
            drives.push(root);
        }
    }
    // Fallback for non-Windows platforms so the app still shows a root.
    if drives.is_empty() {
        drives.push("/".to_string());
    }
    drives
}

#[tauri::command]
fn read_dir(path: String, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();

        if !show_hidden {
            #[cfg(windows)]
            if is_hidden(&meta) {
                continue;
            }
            #[cfg(not(windows))]
            if name.starts_with('.') {
                continue;
            }
        }

        let is_dir = meta.is_dir();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        entries.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            modified,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn read_file_preview(path: String) -> Result<String, String> {
    const MAX: usize = 1_000_000;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let truncated = bytes.len() > MAX;
    let slice = if truncated { &bytes[..MAX] } else { &bytes[..] };
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if truncated {
        text.push_str("\n\n--- [truncated: file larger than 1 MB] ---");
    }
    Ok(text)
}

#[tauri::command]
fn open_path(path: String, with: Option<String>) -> Result<(), String> {
    use std::process::Command;
    if let Some(app) = with.filter(|a| !a.trim().is_empty()) {
        Command::new(app)
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(windows)]
    Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn edit_file(path: String, editor: Option<String>) -> Result<(), String> {
    use std::process::Command;
    if let Some(app) = editor.filter(|a| !a.trim().is_empty()) {
        Command::new(app)
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    // No editor configured: fall back to the OS default *text* editor.
    #[cfg(windows)]
    Command::new("notepad")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg("-t")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Split a command line into program + args, honoring double quotes.
#[cfg(windows)]
fn tokenize(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    let mut has = false;
    for c in s.chars() {
        match c {
            '"' => {
                in_quote = !in_quote;
                has = true;
            }
            c if c.is_whitespace() && !in_quote => {
                if has {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => {
                cur.push(c);
                has = true;
            }
        }
    }
    if has {
        out.push(cur);
    }
    out
}

/// Resolve a program name to a full path via cwd / PATH / PATHEXT, so we can
/// report "command not found" before launching.
#[cfg(windows)]
fn resolve_program(program: &str, cwd: &str) -> Option<std::path::PathBuf> {
    use std::path::{Path, PathBuf};
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.BAT;.CMD;.COM".into())
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    let check = |base: PathBuf| -> Option<PathBuf> {
        if base.is_file() {
            return Some(base);
        }
        for e in &exts {
            let mut s = base.clone().into_os_string();
            s.push(e);
            let p = PathBuf::from(s);
            if p.is_file() {
                return Some(p);
            }
        }
        None
    };
    let p = Path::new(program);
    if program.contains('/') || program.contains('\\') || p.is_absolute() {
        let base = if p.is_absolute() {
            p.to_path_buf()
        } else {
            Path::new(cwd).join(program)
        };
        return check(base);
    }
    let path = std::env::var("PATH").ok()?;
    std::env::split_paths(&path).find_map(|dir| check(dir.join(program)))
}

#[tauri::command]
fn run_command(command: String, cwd: String) -> Result<(), String> {
    use std::process::Command;
    #[cfg(windows)]
    {
        let parts = tokenize(&command);
        let (program, args) = parts.split_first().ok_or("Empty command")?;
        let resolved = resolve_program(program, &cwd)
            .ok_or_else(|| format!("Cannot execute \"{}\": command not found", program))?;
        // Launch through the shell's `start`: interactive consoles (e.g. cmd)
        // get a real console and stay open, GUI apps get none, and the child
        // runs in the pane's directory.
        Command::new("cmd")
            .args(["/C", "start", "", "/D"])
            .arg(&cwd)
            .arg(&resolved)
            .args(args)
            .current_dir(&cwd)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Command::new("sh")
            .arg("-c")
            .arg(&command)
            .current_dir(&cwd)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn parent_dir(path: String) -> Option<String> {
    Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
    }
    Ok(())
}

#[tauri::command]
fn copy_entries(sources: Vec<String>, dest: String) -> Result<(), String> {
    for src in sources {
        let src = Path::new(&src);
        let name = src.file_name().ok_or("invalid source path")?;
        let target = Path::new(&dest).join(name);
        copy_recursive(src, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn move_entries(sources: Vec<String>, dest: String) -> Result<(), String> {
    for src in sources {
        let src = Path::new(&src);
        let name = src.file_name().ok_or("invalid source path")?;
        let target = Path::new(&dest).join(name);
        // Fast path: same volume rename. Fall back to copy + remove across volumes.
        if fs::rename(src, &target).is_err() {
            copy_recursive(src, &target).map_err(|e| e.to_string())?;
            if src.is_dir() {
                fs::remove_dir_all(src).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(src).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_entries(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let p = Path::new(&path);
        let result = if p.is_dir() {
            fs::remove_dir_all(p)
        } else {
            fs::remove_file(p)
        };
        result.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn create_dir(parent: String, name: String) -> Result<(), String> {
    fs::create_dir(Path::new(&parent).join(name)).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let _ = app;
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_drives,
            read_dir,
            read_file_preview,
            open_path,
            edit_file,
            run_command,
            parent_dir,
            copy_entries,
            move_entries,
            delete_entries,
            create_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
