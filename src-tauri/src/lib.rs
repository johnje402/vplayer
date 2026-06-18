// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tauri::{Manager, http::{
    Response, StatusCode, header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE}
}};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use tauri_plugin_cli::CliExt;

type VideoStore = Arc<Mutex<HashMap<String, Arc<Vec<u8>>>>>;

#[derive(Clone)]
struct AppPassword(Option<String>);

fn parse_range(range: &str, total: usize) -> Option<(usize, usize)> {
    // Example: "bytes=1000-2000" or "bytes=1000-"
    let range = range.strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;

    let start: usize = start.parse().ok()?;
    let end: usize = if end.is_empty() {
        total - 1
    } else {
        end.parse().ok()?
    };

    if start > end || end >= total {
        return None;
    }

    Some((start, end))
}

fn decrypt_video(file_bytes: Vec<u8>, password: &str) -> Result<Vec<u8>, String> {
    if file_bytes.len() < 28 {
        return Err("Invalid encrypted file".into());
    }

    let salt = &file_bytes[0..16];
    let nonce = &file_bytes[16..28];
    let ciphertext = &file_bytes[28..];

    let mut key = [0u8; 32];

    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "Wrong password or corrupted file".to_string())?;
    Ok(plaintext)
}

#[tauri::command]
fn load_video_to_memory(
    id: String,
    path: String,
    store: tauri::State<VideoStore>,
    password: tauri::State<'_, AppPassword>,
) -> Result<String, String> {
    let file_bytes = std::fs::read(path).map_err(|e| e.to_string())?;

    let bytes = match password.0.as_deref() {
        Some(pw) => decrypt_video(file_bytes, pw)?,
        _ => file_bytes,
    };

    store
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), Arc::new(bytes));

    Ok(format!("memvideo://localhost/{}", id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let video_store: VideoStore = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .manage(video_store.clone())
        .setup(|app| {
            let matches = app.cli().matches()?;

            let password = matches
                .args
                .get("password")
                .and_then(|arg| arg.value.as_str())
                .map(|s| s.to_string());

            app.manage(AppPassword(password));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_video_to_memory])
        .register_uri_scheme_protocol("memvideo", move |_ctx, request| {
            let id = request.uri().path().trim_start_matches('/').to_string();

            let Some(video) = video_store.lock().unwrap().get(&id).cloned() else {
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap();
            };

            let total = video.len();

            if let Some(range_header) = request.headers().get(RANGE) {
                if let Ok(range_str) = range_header.to_str() {
                    if let Some((start, end)) = parse_range(range_str, total) {
                        let chunk = video[start..=end].to_vec();

                        return Response::builder()
                            .status(StatusCode::PARTIAL_CONTENT)
                            .header(CONTENT_TYPE, "video/mp4")
                            .header(ACCEPT_RANGES, "bytes")
                            .header(CONTENT_LENGTH, chunk.len().to_string())
                            .header(CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, total))
                            .body(chunk)
                            .unwrap();
                    }
                }

                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(CONTENT_RANGE, format!("bytes */{}", total))
                    .body(Vec::new())
                    .unwrap();
            }

            Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, "video/mp4")
                .header(ACCEPT_RANGES, "bytes")
                .header(CONTENT_LENGTH, total.to_string())
                .body(video.as_ref().clone())
                .unwrap()
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
