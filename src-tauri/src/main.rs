#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use tauri::{Manager, State};

struct Store { root: PathBuf, db: Mutex<Connection> }
type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String { e.to_string() }
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn valid_key(key: &str) -> bool { key.len() == 64 && key.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) }
fn pdf_path(root: &Path, key: &str) -> Result<PathBuf> { if !valid_key(key) { return Err("无效的论文文件编号。".into()); } Ok(root.join("pdfs").join(format!("{key}.pdf"))) }
fn validate_pdf(bytes: &[u8]) -> Result<()> { if bytes.len() > 100 * 1024 * 1024 { return Err("单篇 PDF 请控制在 100 MB 以内。".into()); } if !bytes.iter().take(1024).copied().collect::<Vec<_>>().windows(5).any(|w| w == b"%PDF-") { return Err("文件不是有效的 PDF。".into()); } Ok(()) }
fn open_store(root: PathBuf) -> Result<Store> {
  fs::create_dir_all(root.join("pdfs")).map_err(err)?;
  let db = Connection::open(root.join("library.sqlite")).map_err(err)?;
  db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS translations (key TEXT PRIMARY KEY, text TEXT NOT NULL);").map_err(err)?;
  Ok(Store { root, db: Mutex::new(db) })
}
fn validate_library(library: &Value) -> Result<()> {
  if library["version"] != 1 || !library["papers"].is_array() || !library["folders"].is_array() || !library["fields"].is_array() || !library["settings"].is_object() { return Err("论文库格式不正确。".into()); }
  let papers = library["papers"].as_array().unwrap(); let folders = library["folders"].as_array().unwrap(); let fields = library["fields"].as_array().unwrap();
  if fields.is_empty() { return Err("至少需要一个笔记栏目。".into()); }
  for (items, keys) in [(papers, vec!["id", "fileKey", "fileName", "title", "authors", "year", "venue", "tags", "addedAt", "updatedAt"]), (folders, vec!["id", "name"]), (fields, vec!["id", "label"])] {
    let mut ids = HashSet::new(); for item in items { if keys.iter().any(|k| !item[k].is_string()) || !ids.insert(item["id"].as_str().unwrap()) { return Err("记录格式不正确或存在重复编号。".into()); } }
  }
  for f in folders { let mut visited = HashSet::new(); visited.insert(f["id"].as_str().unwrap()); let mut parent = &f["parentId"]; while !parent.is_null() { let id = parent.as_str().ok_or("分类格式不正确。")?; if !visited.insert(id) { return Err("分类不能循环嵌套。".into()); } let found = folders.iter().find(|a| a["id"] == id).ok_or("分类的上级不存在。")?; parent = &found["parentId"]; } }
  for p in papers {
    if !valid_key(p["fileKey"].as_str().unwrap()) || !matches!(p["status"].as_str(), Some("unread"|"reading"|"read")) || p["page"].as_u64().unwrap_or(0) < 1 || !p["notes"].is_object() || p["notes"].as_object().unwrap().values().any(|v| !v.is_string()) || !p["excerpts"].is_array() || !(p["readAt"].is_null() || p["readAt"].is_string()) { return Err("论文记录格式不正确。".into()); }
    for id in p["folderIds"].as_array().ok_or("论文分类格式不正确。")? { if !folders.iter().any(|f| f["id"] == *id) { return Err("论文分类不存在。".into()); } }
    for e in p["excerpts"].as_array().unwrap() { if ["id", "text", "fieldId", "createdAt"].iter().any(|k| !e[k].is_string()) || e["page"].as_u64().unwrap_or(0) < 1 || !matches!(e["kind"].as_str(), Some("quote"|"highlight")) || !(e["translation"].is_null() || e["translation"].is_string()) { return Err("摘录格式不正确。".into()); } for r in e["rects"].as_array().ok_or("摘录位置格式不正确。")? { if r["page"].as_u64().unwrap_or(0) < 1 || ["x", "y", "w", "h"].iter().any(|k| r[k].as_f64().map(|n| !(0.0..=1.0).contains(&n)).unwrap_or(true)) { return Err("摘录位置格式不正确。".into()); } } }
  }
  if fields.iter().any(|f| f["label"].as_str().unwrap().trim().is_empty()) { return Err("笔记栏目名称不能为空。".into()); }
  let settings: Settings = serde_json::from_value(library["settings"].clone()).map_err(err)?;
  if !matches!(settings.google_host.as_str(), "google"|"googleapi") || !matches!(settings.target_language.as_str(), "zh-CN"|"zh-TW") { return Err("翻译设置格式不正确。".into()); }
  Ok(())
}
#[tauri::command]
fn load_library(store: State<Store>) -> Result<Option<Value>> { let db = store.db.lock().map_err(err)?; let mut query = db.prepare("SELECT payload FROM library WHERE id=1").map_err(err)?; let mut rows = query.query([]).map_err(err)?; if let Some(row) = rows.next().map_err(err)? { let text: String = row.get(0).map_err(err)?; Ok(Some(serde_json::from_str(&text).map_err(err)?)) } else { Ok(None) } }
fn persist(store: &Store, library: &Value) -> Result<()> { validate_library(library)?; for p in library["papers"].as_array().unwrap() { if !pdf_path(&store.root, p["fileKey"].as_str().unwrap())?.exists() { return Err("论文原件不存在，未保存。".into()); } } let text = serde_json::to_string(library).map_err(err)?; store.db.lock().map_err(err)?.execute("INSERT INTO library(id,payload) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![text]).map_err(err)?; Ok(()) }
#[tauri::command]
fn save_library(store: State<Store>, library: Value) -> Result<()> { persist(&store, &library) }
fn store_pdf(store: &Store, bytes: &[u8]) -> Result<String> { validate_pdf(bytes)?; let key = digest(bytes); let path = pdf_path(&store.root, &key)?; if !path.exists() { write_pdf(&path, bytes)?; } Ok(key) }
fn write_pdf(path: &Path, bytes: &[u8]) -> Result<()> {
  let temporary = path.with_extension("pdf.pending");
  let mut file = fs::File::create(&temporary).map_err(err)?;
  std::io::Write::write_all(&mut file, bytes).map_err(err)?;
  file.sync_all().map_err(err)?; drop(file);
  fs::rename(temporary, path).map_err(err)
}
#[tauri::command]
fn import_pdf_bytes(store: State<Store>, bytes: Vec<u8>) -> Result<String> { store_pdf(&store, &bytes) }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct Imported { file_key: String, file_name: String }
#[tauri::command]
fn import_pdfs(store: State<Store>, paths: Vec<String>) -> Result<Vec<Imported>> {
  let mut result = Vec::new(); for input in paths { let path = Path::new(&input); let length = fs::metadata(path).map_err(err)?.len(); if length > 100 * 1024 * 1024 { return Err("单篇 PDF 请控制在 100 MB 以内。".into()); } let bytes = fs::read(path).map_err(err)?; result.push(Imported { file_key: store_pdf(&store, &bytes)?, file_name: path.file_name().ok_or("无效文件名。")?.to_string_lossy().into_owned() }); } Ok(result)
}
#[tauri::command]
fn read_pdf(store: State<Store>, file_key: String) -> Result<Vec<u8>> { fs::read(pdf_path(&store.root, &file_key)?).map_err(err) }
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Settings { google_host: String, target_language: String, proxy: String, #[allow(dead_code)] auto_translate: bool }
fn parse_translation(value: &Value) -> Result<String> { let text = value[0].as_array().ok_or("Google 返回的数据格式不正确。")?.iter().filter_map(|segment| segment[0].as_str()).collect::<String>(); if text.trim().is_empty() { Err("Google 没有返回译文，请重试。".into()) } else { Ok(text) } }
#[tauri::command]
async fn translate_google(store: State<'_, Store>, text: String, settings: Settings) -> Result<String> {
  if text.trim().is_empty() || text.chars().count() > 5000 { return Err("一次请选择 1～5000 个字符。".into()); }
  let host = match settings.google_host.as_str() { "google" => "https://translate.google.com/translate_a/single", "googleapi" => "https://translate.googleapis.com/translate_a/single", _ => return Err("无效的翻译源。".into()) };
  if !matches!(settings.target_language.as_str(), "zh-CN"|"zh-TW") { return Err("无效的目标语言。".into()); }
  let key = digest(format!("{host}|{}|{text}", settings.target_language).as_bytes());
  { let db = store.db.lock().map_err(err)?; if let Ok(cached) = db.query_row("SELECT text FROM translations WHERE key=?1", params![key], |row| row.get::<_, String>(0)) { return Ok(cached); } }
  let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(20)).user_agent("Mozilla/5.0 Interleaf/0.1.2");
  if !settings.proxy.trim().is_empty() { builder = builder.proxy(reqwest::Proxy::all(&settings.proxy).map_err(|_| "代理地址格式不正确。")?); }
  let response = builder.build().map_err(err)?.get(host).query(&[("client", "gtx"), ("sl", "auto"), ("tl", settings.target_language.as_str()), ("dt", "t"), ("q", text.as_str())]).send().await.map_err(|e| format!("无法连接 Google，请检查网络或在设置中填写代理地址。{e}"))?;
  if !response.status().is_success() { return Err(format!("Google 返回 {}，请稍后重试或切换翻译源。", response.status())); }
  let value: Value = response.json().await.map_err(|_| "Google 返回的数据无法解析。")?; let result = parse_translation(&value)?;
  store.db.lock().map_err(err)?.execute("INSERT OR REPLACE INTO translations(key,text) VALUES(?1,?2)", params![key, result]).map_err(err)?; Ok(result)
}
#[tauri::command]
fn write_export(path: String, content: String) -> Result<()> { fs::write(path, content).map_err(err) }
#[tauri::command]
fn export_backup(store: State<Store>, path: String) -> Result<()> {
  let library: String = store.db.lock().map_err(err)?.query_row("SELECT payload FROM library WHERE id=1", [], |r| r.get(0)).map_err(err)?;
  let library: Value = serde_json::from_str(&library).map_err(err)?; let mut pdfs = serde_json::Map::new();
  for p in library["papers"].as_array().ok_or("论文库格式不正确。")? { let key = p["fileKey"].as_str().ok_or("文件编号格式不正确。")?; if !pdfs.contains_key(key) { let bytes = fs::read(pdf_path(&store.root, key)?).map_err(err)?; pdfs.insert(key.into(), Value::String(STANDARD.encode(bytes))); } }
  let pack = json!({ "format": "paper-journal-backup", "version": 1, "library": library, "pdfs": pdfs });
  fs::write(path, serde_json::to_vec(&pack).map_err(err)?).map_err(err)
}
fn restore_pack(store: &Store, pack: Value) -> Result<Value> {
  if pack["format"] != "paper-journal-backup" || pack["version"] != 1 { return Err("这不是有效的纸间备份。".into()); }
  let library = &pack["library"]; validate_library(library)?; let mut files = Vec::new(); let mut seen = HashSet::new();
  for p in library["papers"].as_array().unwrap() { let key = p["fileKey"].as_str().unwrap(); if seen.insert(key) { let bytes = STANDARD.decode(pack["pdfs"][key].as_str().ok_or("备份缺少 PDF 原件。")?).map_err(err)?; validate_pdf(&bytes)?; if digest(&bytes) != key { return Err("备份中的 PDF 校验失败。".into()); } files.push((key, bytes)); } }
  for (key, bytes) in files { let path = pdf_path(&store.root, key)?; if !path.exists() { write_pdf(&path, &bytes)?; } }
  persist(store, library)?; Ok(library.clone())
}
#[tauri::command]
fn restore_backup(store: State<Store>, path: String) -> Result<Value> { let bytes = fs::read(path).map_err(err)?; let pack: Value = serde_json::from_slice(&bytes).map_err(err)?; restore_pack(&store, pack) }
#[tauri::command]
fn data_location(store: State<Store>) -> String { store.root.to_string_lossy().into_owned() }
fn main() {
  tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app| {
    let root = if cfg!(debug_assertions) { std::env::var_os("PAPER_JOURNAL_DATA_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.test-library")) } else { app.path().app_data_dir()? };
    app.manage(open_store(root).map_err(std::io::Error::other)?); Ok(())
  }).invoke_handler(tauri::generate_handler![load_library, save_library, import_pdfs, import_pdf_bytes, read_pdf, translate_google, write_export, export_backup, restore_backup, data_location]).run(tauri::generate_context!()).expect("无法启动纸间");
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test] fn translation_segments() { assert_eq!(parse_translation(&json!([[ ["研究", "Research"], ["方法", "method"] ]])).unwrap(), "研究方法"); assert!(parse_translation(&json!({})).is_err()); assert!(parse_translation(&json!([[ [null, "x"] ]])).is_err()); }
  #[test] fn attachment_keys_cannot_escape() { assert!(pdf_path(Path::new("."), "../../secrets").is_err()); assert!(valid_key(&digest(b"test"))); }
  #[test] fn reject_fake_or_oversize_pdf() { assert!(validate_pdf(b"hello").is_err()); assert!(validate_pdf(b"%PDF-1.7\n").is_ok()); }
  #[test] fn invalid_restore_preserves_library() {
    let root = std::env::temp_dir().join(format!("paper-journal-test-{}", std::process::id())); let store = open_store(root.clone()).unwrap();
    let library = json!({"version":1,"papers":[],"folders":[],"fields":[{"id":"a","label":"笔记"}],"settings":{"googleHost":"googleapi","targetLanguage":"zh-CN","proxy":"","autoTranslate":false}});
    persist(&store, &library).unwrap(); assert!(restore_pack(&store, json!({"format":"paper-journal-backup","version":2,"library":library})).is_err());
    let saved: String = store.db.lock().unwrap().query_row("SELECT payload FROM library", [], |r| r.get(0)).unwrap(); assert_eq!(serde_json::from_str::<Value>(&saved).unwrap(), library);
    drop(store); let reopened = open_store(root.clone()).unwrap(); assert!(reopened.db.lock().unwrap().query_row("SELECT payload FROM library", [], |r| r.get::<_, String>(0)).is_ok()); drop(reopened); fs::remove_dir_all(root).unwrap();
  }
  #[test] fn restore_roundtrip_with_pdf_and_notes() {
    let root = std::env::temp_dir().join(format!("paper-journal-roundtrip-{}", std::process::id()));
    let store = open_store(root.clone()).unwrap(); let bytes = b"%PDF-1.7\nfixture"; let key = digest(bytes);
    let library = json!({"version":1,"papers":[{"id":"p","fileKey":key,"fileName":"paper.pdf","title":"论文","authors":"","year":"2026","venue":"","tags":"","addedAt":"2026-10-12","updatedAt":"2026-10-12","readAt":null,"status":"reading","page":2,"folderIds":["f"],"notes":{"question":"手写研究问题"},"excerpts":[]}],"folders":[{"id":"f","name":"课题","parentId":null}],"fields":[{"id":"question","label":"研究问题"}],"settings":{"googleHost":"googleapi","targetLanguage":"zh-CN","proxy":"","autoTranslate":false}});
    let mut pdfs = serde_json::Map::new(); pdfs.insert(key.clone(), Value::String(STANDARD.encode(bytes)));
    let pack = json!({"format":"paper-journal-backup","version":1,"library":library,"pdfs":pdfs});
    assert_eq!(restore_pack(&store, pack.clone()).unwrap(), library);
    assert_eq!(fs::read(pdf_path(&root, &key).unwrap()).unwrap(), bytes);
    let mut invalid = pack; invalid["library"]["settings"]["googleHost"] = json!("invalid");
    assert!(restore_pack(&store, invalid).is_err());
    let saved: String = store.db.lock().unwrap().query_row("SELECT payload FROM library", [], |r| r.get(0)).unwrap(); assert_eq!(serde_json::from_str::<Value>(&saved).unwrap(), library);
    drop(store); fs::remove_dir_all(root).unwrap();
  }
}
