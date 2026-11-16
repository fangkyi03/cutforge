// CutForge 桌面外壳：启动随包附带的 Node 运行 CutForge 服务，再把窗口指向它的界面。
// 菜单里可以新建／打开工程，切换时重启服务。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

struct Server(Mutex<Option<Child>>);

fn node_path(res: &Path) -> PathBuf {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    res.join("node").join(name)
}

fn stop(app: &AppHandle) {
    if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn show_error(app: &AppHandle, msg: String) {
    if let Some(w) = app.get_webview_window("main") {
        let js = format!("document.body.innerHTML = '<pre style=\"padding:24px;white-space:pre-wrap;font:13px ui-monospace,monospace\">' + {} + '</pre>'", serde_json_string(&msg));
        let _ = w.eval(&js);
    }
}

fn serde_json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '<' => out.push_str("&lt;"),
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// project: None = 打开上次的工程（没有就新建）
fn start(app: &AppHandle, project: Option<PathBuf>) {
    stop(app);
    let res = match app.path().resource_dir() {
        Ok(p) => p,
        Err(e) => return show_error(app, format!("找不到资源目录：{e}")),
    };
    let entry = res.join("app").join("bin").join("cutforge.mjs");
    let mut cmd = Command::new(node_path(&res));
    cmd.arg(&entry).arg("open");
    match &project {
        Some(p) => {
            cmd.arg(p);
        }
        None => {
            cmd.arg("--last");
        }
    }
    cmd.arg("--no-open").stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return show_error(app, format!("启动 CutForge 服务失败：{e}\n{}", node_path(&res).display())),
    };
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    app.state::<Server>().0.lock().unwrap().replace(child);

    let handle = app.clone();
    thread::spawn(move || {
        let mut errs = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            errs.push_str(&line);
            errs.push('\n');
            if errs.len() > 8000 {
                break;
            }
        }
        if !errs.trim().is_empty() {
            eprintln!("{errs}");
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Some(w) = h.get_webview_window("main") {
                    if w.url().map(|u| u.scheme() != "http").unwrap_or(true) {
                        show_error(&h, format!("CutForge 服务出错：\n{errs}"));
                    }
                }
            });
        }
    });
    let handle = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(url) = line.strip_prefix("CUTFORGE_URL ") {
                if let Ok(url) = Url::parse(url.trim()) {
                    let h = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        if let Some(w) = h.get_webview_window("main") {
                            let _ = w.navigate(url);
                        }
                    });
                }
            }
        }
    });
}

fn pick_and_open(app: &AppHandle, new_project: bool) {
    let handle = app.clone();
    let title = if new_project { "选择放新工程的空文件夹" } else { "打开工程文件夹（里面有 film.html）" };
    app.dialog().file().set_title(title).pick_folder(move |folder| {
        if let Some(folder) = folder.and_then(|f| f.into_path().ok()) {
            if !new_project && !folder.join("film.html").exists() {
                handle.dialog().message("这个文件夹里没有 film.html，不是 CutForge 工程。").title("打开工程").show(|_| {});
                return;
            }
            start(&handle, Some(folder));
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle();
            let new_item = MenuItem::with_id(handle, "new", "新建工程…", true, Some("CmdOrCtrl+N"))?;
            let open_item = MenuItem::with_id(handle, "open", "打开工程…", true, Some("CmdOrCtrl+O"))?;
            let reload_item = MenuItem::with_id(handle, "reload", "重新加载界面", true, Some("CmdOrCtrl+R"))?;
            let file = Submenu::with_items(handle, "文件", true, &[&new_item, &open_item, &PredefinedMenuItem::separator(handle)?, &reload_item])?;
            let edit = Submenu::with_items(handle, "编辑", true, &[
                &PredefinedMenuItem::undo(handle, None)?, &PredefinedMenuItem::redo(handle, None)?, &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::cut(handle, None)?, &PredefinedMenuItem::copy(handle, None)?, &PredefinedMenuItem::paste(handle, None)?,
                &PredefinedMenuItem::select_all(handle, None)?,
            ])?;
            let window = Submenu::with_items(handle, "窗口", true, &[&PredefinedMenuItem::minimize(handle, None)?, &PredefinedMenuItem::fullscreen(handle, None)?])?;
            #[cfg(target_os = "macos")]
            let menu = {
                let app_menu = Submenu::with_items(handle, "CutForge", true, &[
                    &PredefinedMenuItem::about(handle, Some("关于 CutForge"), None)?, &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?, &PredefinedMenuItem::quit(handle, None)?,
                ])?;
                Menu::with_items(handle, &[&app_menu, &file, &edit, &window])?
            };
            #[cfg(not(target_os = "macos"))]
            let menu = Menu::with_items(handle, &[&file, &edit, &window])?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "new" => pick_and_open(app, true),
                "open" => pick_and_open(app, false),
                "reload" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.eval("location.reload()");
                    }
                }
                _ => {}
            });

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("CutForge")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1100.0, 680.0)
                .build()?;
            start(handle, None);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("CutForge 启动失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                stop(app);
            }
        });
}
