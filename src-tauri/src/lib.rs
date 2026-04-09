mod db;

use db::{
  initialize_database, BootstrapStatus, BottleCodeValidationResult, BottleRevealResult,
  BottleInventoryItem, BottleInventoryListResult, BottlesImportSummary,
  DatabaseBackupExportResult, DatabaseBackupMetadata, DatabaseBackupRestoreResult,
  DatabaseState, DeletedSessionResult, GeneratedBottleCodeResult, MaterialInventoryItem,
  MaterialInventoryListResult, MaterialSearchResult, MaterialsImportSummary,
  PerformanceSnapshot, RevealAttemptResult, SessionCompletionResult, SessionEntryInput,
  SessionNoteResult, SessionStartResult,
};
use tauri::{Manager, State};

#[tauri::command]
fn get_bootstrap_status(database: State<'_, DatabaseState>) -> Result<BootstrapStatus, String> {
  database.bootstrap_status()
}

#[tauri::command]
fn export_database_backup(
  destination_path: String,
  database: State<'_, DatabaseState>,
) -> Result<DatabaseBackupExportResult, String> {
  database.export_backup(destination_path)
}

#[tauri::command]
fn inspect_database_backup(
  backup_path: String,
  database: State<'_, DatabaseState>,
) -> Result<DatabaseBackupMetadata, String> {
  database.inspect_backup(backup_path)
}

#[tauri::command]
fn restore_database_backup(
  backup_path: String,
  database: State<'_, DatabaseState>,
) -> Result<DatabaseBackupRestoreResult, String> {
  database.restore_backup(backup_path)
}

#[tauri::command]
fn start_session(
  target_batch_size: u32,
  database: State<'_, DatabaseState>,
) -> Result<SessionStartResult, String> {
  database.start_session(target_batch_size)
}

#[tauri::command]
fn validate_bottle_code(
  code: u32,
  database: State<'_, DatabaseState>,
) -> Result<BottleCodeValidationResult, String> {
  database.validate_bottle_code(code)
}

#[tauri::command]
fn search_materials(
  query: String,
  limit: Option<u32>,
  database: State<'_, DatabaseState>,
) -> Result<MaterialSearchResult, String> {
  database.search_materials(query, limit)
}

#[tauri::command]
fn reveal_attempt(
  session_id: String,
  code: u32,
  guessed_material_id: String,
  pre_reveal_note: Option<String>,
  database: State<'_, DatabaseState>,
) -> Result<RevealAttemptResult, String> {
  database.reveal_attempt(session_id, code, guessed_material_id, pre_reveal_note)
}

#[tauri::command]
fn reveal_bottle_code(
  code: u32,
  database: State<'_, DatabaseState>,
) -> Result<BottleRevealResult, String> {
  database.reveal_bottle_code(code)
}

#[tauri::command]
fn update_session_note(
  session_id: String,
  session_note: Option<String>,
  database: State<'_, DatabaseState>,
) -> Result<SessionNoteResult, String> {
  database.update_session_note(session_id, session_note)
}

#[tauri::command]
fn complete_session(
  session_id: String,
  entries: Vec<SessionEntryInput>,
  database: State<'_, DatabaseState>,
) -> Result<SessionCompletionResult, String> {
  database.complete_session(session_id, entries)
}

#[tauri::command]
fn get_performance_snapshot(
  database: State<'_, DatabaseState>,
) -> Result<PerformanceSnapshot, String> {
  database.get_performance_snapshot()
}

#[tauri::command]
fn delete_session(
  session_id: String,
  database: State<'_, DatabaseState>,
) -> Result<DeletedSessionResult, String> {
  database.delete_session(session_id)
}

#[tauri::command]
fn list_inventory_materials(
  database: State<'_, DatabaseState>,
) -> Result<MaterialInventoryListResult, String> {
  database.list_inventory_materials()
}

#[tauri::command]
fn create_inventory_material(
  name: String,
  database: State<'_, DatabaseState>,
) -> Result<MaterialInventoryItem, String> {
  database.create_inventory_material(name)
}

#[tauri::command]
fn update_inventory_material(
  material_id: String,
  name: String,
  status: String,
  database: State<'_, DatabaseState>,
) -> Result<MaterialInventoryItem, String> {
  database.update_inventory_material(material_id, name, status)
}

#[tauri::command]
fn archive_inventory_material(
  material_id: String,
  database: State<'_, DatabaseState>,
) -> Result<MaterialInventoryItem, String> {
  database.archive_inventory_material(material_id)
}

#[tauri::command]
fn list_inventory_bottles(
  database: State<'_, DatabaseState>,
) -> Result<BottleInventoryListResult, String> {
  database.list_inventory_bottles()
}

#[tauri::command]
fn generate_inventory_bottle_code(
  database: State<'_, DatabaseState>,
) -> Result<GeneratedBottleCodeResult, String> {
  database.generate_inventory_bottle_code()
}

#[tauri::command]
fn create_inventory_bottle(
  material_id: String,
  code: u32,
  dilution: String,
  database: State<'_, DatabaseState>,
) -> Result<BottleInventoryItem, String> {
  database.create_inventory_bottle(material_id, code, dilution)
}

#[tauri::command]
fn update_inventory_bottle(
  bottle_id: String,
  material_id: String,
  code: u32,
  dilution: String,
  status: String,
  database: State<'_, DatabaseState>,
) -> Result<BottleInventoryItem, String> {
  database.update_inventory_bottle(bottle_id, material_id, code, dilution, status)
}

#[tauri::command]
fn archive_inventory_bottle(
  bottle_id: String,
  database: State<'_, DatabaseState>,
) -> Result<BottleInventoryItem, String> {
  database.archive_inventory_bottle(bottle_id)
}

#[tauri::command]
fn preview_materials_import(
  file_path: String,
  database: State<'_, DatabaseState>,
) -> Result<MaterialsImportSummary, String> {
  database.preview_materials_import(file_path)
}

#[tauri::command]
fn commit_materials_import(
  file_path: String,
  database: State<'_, DatabaseState>,
) -> Result<MaterialsImportSummary, String> {
  database.commit_materials_import(file_path)
}

#[tauri::command]
fn preview_bottles_import(
  file_path: String,
  mode: String,
  database: State<'_, DatabaseState>,
) -> Result<BottlesImportSummary, String> {
  database.preview_bottles_import(file_path, mode)
}

#[tauri::command]
fn commit_bottles_import(
  file_path: String,
  mode: String,
  database: State<'_, DatabaseState>,
) -> Result<BottlesImportSummary, String> {
  database.commit_bottles_import(file_path, mode)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let database = initialize_database(app.handle())?;
      app.manage(database);
      app.handle().plugin(tauri_plugin_dialog::init())?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_bootstrap_status,
      export_database_backup,
      inspect_database_backup,
      restore_database_backup,
      start_session,
      validate_bottle_code,
      search_materials,
      reveal_bottle_code,
      reveal_attempt,
      update_session_note,
      complete_session,
      get_performance_snapshot,
      delete_session,
      list_inventory_materials,
      create_inventory_material,
      update_inventory_material,
      archive_inventory_material,
      list_inventory_bottles,
      generate_inventory_bottle_code,
      create_inventory_bottle,
      update_inventory_bottle,
      archive_inventory_bottle,
      preview_materials_import,
      commit_materials_import,
      preview_bottles_import,
      commit_bottles_import
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
