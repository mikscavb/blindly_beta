use std::{
  collections::{HashMap, HashSet},
  env,
  fs,
  path::{Path, PathBuf},
  time::{SystemTime, UNIX_EPOCH},
};

use csv::StringRecord;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const DB_FILENAME: &str = "blindly.sqlite3";
const SCHEMA_VERSION: u32 = 3;
const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
const ATTEMPT_TRUTH_MIGRATION: &str = include_str!("../migrations/0002_attempt_truth.sql");
const SESSION_ENTRY_MIGRATION: &str = include_str!("../migrations/0003_session_entries.sql");
const REQUIRED_BACKUP_TABLES: [&str; 7] = [
  "materials",
  "bottles",
  "sessions",
  "attempts",
  "session_entries",
  "imports",
  "bottle_assignment_audit",
];

pub struct DatabaseState {
  db_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
  db_path: String,
  schema_version: u32,
  table_count: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupMetadata {
  path: String,
  file_size_bytes: u64,
  schema_version: u32,
  table_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupExportResult {
  backup: DatabaseBackupMetadata,
  database_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupRestoreResult {
  restored_backup: DatabaseBackupMetadata,
  database_path: String,
  previous_database_backup_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartResult {
  session_id: String,
  target_batch_size: u32,
  started_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BottleCodeValidationResult {
  code: u32,
  status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSearchItem {
  id: String,
  name: String,
  status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSearchResult {
  results: Vec<MaterialSearchItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialInventoryListResult {
  items: Vec<MaterialInventoryItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialInventoryItem {
  id: String,
  name: String,
  status: String,
  active_bottle_count: u32,
  archived_bottle_count: u32,
  attempt_count: u32,
  created_at: String,
  updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BottleInventoryListResult {
  items: Vec<BottleInventoryItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BottleInventoryItem {
  id: String,
  material_id: String,
  material_name: String,
  material_status: String,
  code: u32,
  dilution: String,
  status: String,
  created_at: String,
  updated_at: String,
  archived_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedBottleCodeResult {
  code: u32,
  remaining_assignable_codes: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSummary {
  id: String,
  name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealAttemptResult {
  attempt_id: String,
  session_id: String,
  code: u32,
  true_material: MaterialSummary,
  guessed_material: MaterialSummary,
  is_correct: bool,
  revealed_at: String,
  completed_attempts: u32,
  target_batch_size: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BottleRevealResult {
  code: u32,
  true_material: MaterialSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNoteResult {
  session_id: String,
  session_note: Option<String>,
  updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedSessionResult {
  session_id: String,
  deleted_attempt_count: u32,
  deleted_entry_count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntryInput {
  sequence: u32,
  code: Option<u32>,
  guessed_material_id: Option<String>,
  pre_reveal_note: Option<String>,
  skipped: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReportRow {
  sequence: u32,
  code: Option<u32>,
  guessed_material_name: Option<String>,
  true_material_name: String,
  status: String,
  note: String,
  revealed_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompletionResult {
  rows: Vec<SessionReportRow>,
  correct_count: u32,
  guessed_count: u32,
  skipped_count: u32,
  completed_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
  sessions: Vec<PerformanceSessionRecord>,
  attempts: Vec<PerformanceAttemptRecord>,
  entries: Vec<PerformanceSessionEntryRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSessionRecord {
  session_id: String,
  started_at: String,
  ended_at: Option<String>,
  target_batch_size: u32,
  session_note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceAttemptRecord {
  attempt_id: String,
  session_id: String,
  bottle_id: String,
  bottle_code: u32,
  dilution: String,
  true_material_id: String,
  true_material_name: String,
  guessed_material_id: String,
  guessed_material_name: String,
  is_correct: bool,
  pre_reveal_note: Option<String>,
  revealed_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSessionEntryRecord {
  entry_id: String,
  session_id: String,
  sequence: u32,
  bottle_id: Option<String>,
  bottle_code: Option<u32>,
  dilution: Option<String>,
  true_material_id: Option<String>,
  true_material_name: Option<String>,
  guessed_material_id: Option<String>,
  guessed_material_name: Option<String>,
  status: String,
  pre_reveal_note: Option<String>,
  revealed_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
  row: u32,
  message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialsImportSummary {
  rows_read: u32,
  creates: u32,
  duplicates_skipped: u32,
  errors: Vec<ImportIssue>,
  committed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BottlesImportSummary {
  mode: String,
  rows_read: u32,
  create_materials: u32,
  create_bottles: u32,
  update_bottles: u32,
  errors: Vec<ImportIssue>,
  committed: bool,
}

#[derive(Clone)]
struct ExistingMaterial {
  id: String,
}

#[derive(Clone)]
struct ExistingBottle {
  material_id: String,
  status: String,
}

struct MaterialsImportAnalysis {
  rows_read: u32,
  duplicates_skipped: u32,
  errors: Vec<ImportIssue>,
  new_materials: Vec<PlannedMaterial>,
}

struct BottlesImportAnalysis {
  mode: ImportMode,
  rows_read: u32,
  errors: Vec<ImportIssue>,
  new_materials: Vec<PlannedMaterial>,
  actions: Vec<PlannedBottleAction>,
}

#[derive(Clone)]
struct PlannedMaterial {
  normalized_name: String,
  display_name: String,
}

enum PlannedBottleAction {
  Create {
    code: u32,
    dilution: String,
    normalized_name: String,
  },
  Update {
    code: u32,
    dilution: String,
    normalized_name: String,
    previous_material_id: String,
  },
}

#[derive(Clone, Copy)]
enum ImportMode {
  AppendOnly,
  UpsertByCode,
}

impl ImportMode {
  fn parse(value: &str) -> Result<Self, String> {
    match value {
      "append_only" => Ok(Self::AppendOnly),
      "upsert_by_code" => Ok(Self::UpsertByCode),
      _ => Err("import mode must be 'append_only' or 'upsert_by_code'".into()),
    }
  }

  fn as_str(self) -> &'static str {
    match self {
      Self::AppendOnly => "append_only",
      Self::UpsertByCode => "upsert_by_code",
    }
  }
}

pub fn initialize_database(app: &AppHandle) -> Result<DatabaseState, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

  fs::create_dir_all(&app_data_dir)
    .map_err(|error| format!("failed to create app data directory: {error}"))?;

  let db_path = app_data_dir.join(DB_FILENAME);
  let connection = open_connection(&db_path)?;

  run_migrations(&connection)?;

  Ok(DatabaseState { db_path })
}

impl DatabaseState {
  pub fn bootstrap_status(&self) -> Result<BootstrapStatus, String> {
    let connection = open_connection(&self.db_path)?;
    let schema_version = read_user_version(&connection)?;
    let table_count = connection
      .query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get::<_, u32>(0),
      )
      .map_err(|error| format!("failed to read table count: {error}"))?;

    Ok(BootstrapStatus {
      db_path: self.db_path.display().to_string(),
      schema_version,
      table_count,
    })
  }

  pub fn export_backup(
    &self,
    destination_path: String,
  ) -> Result<DatabaseBackupExportResult, String> {
    let backup_path = resolve_backup_output_path(&destination_path)?;
    let live_db_canonical =
      fs::canonicalize(&self.db_path).unwrap_or_else(|_| self.db_path.clone());

    if backup_path == live_db_canonical {
      return Err("backup destination cannot be the live database path".into());
    }

    let connection = open_connection(&self.db_path)?;
    let backup_path_string = backup_path.display().to_string();

    if let Err(error) = connection.execute("VACUUM INTO ?1", params![backup_path_string]) {
      let _ = fs::remove_file(&backup_path);
      return Err(format!("failed to export database backup: {error}"));
    }

    let backup = inspect_database_file(&backup_path)?;

    Ok(DatabaseBackupExportResult {
      backup,
      database_path: self.db_path.display().to_string(),
    })
  }

  pub fn inspect_backup(&self, backup_path: String) -> Result<DatabaseBackupMetadata, String> {
    let resolved_path = resolve_backup_input_path(&backup_path)?;
    inspect_database_file(&resolved_path)
  }

  pub fn restore_backup(
    &self,
    backup_path: String,
  ) -> Result<DatabaseBackupRestoreResult, String> {
    let resolved_backup_path = resolve_backup_input_path(&backup_path)?;
    let backup_canonical =
      fs::canonicalize(&resolved_backup_path).unwrap_or_else(|_| resolved_backup_path.clone());
    let live_db_canonical =
      fs::canonicalize(&self.db_path).unwrap_or_else(|_| self.db_path.clone());

    if backup_canonical == live_db_canonical {
      return Err("restore source must be a backup copy, not the live database file".into());
    }

    let restored_backup = inspect_database_file(&resolved_backup_path)?;
    let staged_restore_path = sibling_backup_path(&self.db_path, "restore_staging")?;

    fs::copy(&resolved_backup_path, &staged_restore_path)
      .map_err(|error| format!("failed to stage restore file: {error}"))?;

    if let Err(error) = inspect_database_file(&staged_restore_path) {
      let _ = fs::remove_file(&staged_restore_path);
      return Err(error);
    }

    let previous_database_backup_path = if self.db_path.exists() {
      let archived_path = sibling_backup_path(&self.db_path, "pre_restore")?;
      fs::rename(&self.db_path, &archived_path)
        .map_err(|error| format!("failed to archive current database before restore: {error}"))?;
      Some(archived_path)
    } else {
      None
    };

    if let Err(error) = fs::rename(&staged_restore_path, &self.db_path) {
      if let Some(previous_path) = &previous_database_backup_path {
        let _ = fs::rename(previous_path, &self.db_path);
      }
      let _ = fs::remove_file(&staged_restore_path);

      return Err(format!("failed to replace local database during restore: {error}"));
    }

    if let Err(error) = inspect_database_file(&self.db_path) {
      let _ = fs::remove_file(&self.db_path);
      if let Some(previous_path) = &previous_database_backup_path {
        let _ = fs::rename(previous_path, &self.db_path);
      }

      return Err(format!("restored database failed validation: {error}"));
    }

    Ok(DatabaseBackupRestoreResult {
      restored_backup,
      database_path: self.db_path.display().to_string(),
      previous_database_backup_path: previous_database_backup_path
        .map(|path| path.display().to_string()),
    })
  }

  pub fn start_session(&self, target_batch_size: u32) -> Result<SessionStartResult, String> {
    if target_batch_size == 0 {
      return Err("target batch size must be greater than zero".into());
    }

    let connection = open_connection(&self.db_path)?;
    let session_id = generate_session_id()?;

    connection
      .execute(
        "
          INSERT INTO sessions (
            id,
            target_batch_size,
            session_note,
            started_at,
            ended_at,
            created_at,
            updated_at
          ) VALUES (
            ?1,
            ?2,
            NULL,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            NULL,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
        ",
        params![session_id, target_batch_size],
      )
      .map_err(|error| format!("failed to create session: {error}"))?;

    connection
      .query_row(
        "
          SELECT id, target_batch_size, started_at
          FROM sessions
          WHERE id = ?1
        ",
        params![session_id],
        |row| {
          Ok(SessionStartResult {
            session_id: row.get(0)?,
            target_batch_size: row.get(1)?,
            started_at: row.get(2)?,
          })
        },
      )
      .map_err(|error| format!("failed to read created session: {error}"))
  }

  pub fn validate_bottle_code(&self, code: u32) -> Result<BottleCodeValidationResult, String> {
    validate_code_format(code)?;

    let connection = open_connection(&self.db_path)?;
    let exists = connection
      .query_row(
        "
          SELECT 1
          FROM bottles
          WHERE code = ?1 AND status = 'active'
          LIMIT 1
        ",
        params![code],
        |row| row.get::<_, i64>(0),
      )
      .is_ok();

    Ok(BottleCodeValidationResult {
      code,
      status: if exists {
        "valid".into()
      } else {
        "invalid".into()
      },
    })
  }

  pub fn search_materials(&self, query: String, limit: Option<u32>) -> Result<MaterialSearchResult, String> {
    let connection = open_connection(&self.db_path)?;
    let search_term = format!("%{}%", query.trim().to_lowercase());
    let search_limit = i64::from(limit.unwrap_or(12));
    let mut statement = connection
      .prepare(
        "
          SELECT id, name, status
          FROM materials
          WHERE status = 'active'
            AND lower(name) LIKE ?1
          ORDER BY name ASC
          LIMIT ?2
        ",
      )
      .map_err(|error| format!("failed to prepare material search: {error}"))?;

    let mapped_rows = statement
      .query_map(params![search_term, search_limit], |row| {
        Ok(MaterialSearchItem {
          id: row.get(0)?,
          name: row.get(1)?,
          status: row.get(2)?,
        })
      })
      .map_err(|error| format!("failed to search materials: {error}"))?;

    let results = mapped_rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to collect material search results: {error}"))?;

    Ok(MaterialSearchResult { results })
  }

  pub fn reveal_attempt(
    &self,
    session_id: String,
    code: u32,
    guessed_material_id: String,
    pre_reveal_note: Option<String>,
  ) -> Result<RevealAttemptResult, String> {
    validate_code_format(code)?;

    let mut connection = open_connection(&self.db_path)?;
    let transaction = connection
      .transaction()
      .map_err(|error| format!("failed to start attempt transaction: {error}"))?;

    let target_batch_size = transaction
      .query_row(
        "
          SELECT target_batch_size
          FROM sessions
          WHERE id = ?1
        ",
        params![session_id],
        |row| row.get::<_, u32>(0),
      )
      .map_err(|error| format!("failed to load session for attempt: {error}"))?;

    let (bottle_id, true_material_id, true_material_name) = transaction
      .query_row(
        "
          SELECT bottles.id, materials.id, materials.name
          FROM bottles
          INNER JOIN materials ON materials.id = bottles.material_id
          WHERE bottles.code = ?1
            AND bottles.status = 'active'
          LIMIT 1
        ",
        params![code],
        |row| {
          Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
          ))
        },
      )
      .map_err(|error| format!("failed to resolve active bottle for reveal: {error}"))?;

    let guessed_material_name = transaction
      .query_row(
        "
          SELECT name
          FROM materials
          WHERE id = ?1
            AND status = 'active'
        ",
        params![guessed_material_id],
        |row| row.get::<_, String>(0),
      )
      .map_err(|error| format!("failed to resolve guessed material: {error}"))?;
    let guessed_material_id_for_result = guessed_material_id.clone();

    let attempt_id = generate_entity_id("attempt")?;

    transaction
      .execute(
        "
          INSERT INTO attempts (
            id,
            session_id,
            bottle_id,
            code_entered,
            material_id_at_reveal,
            guessed_material_id,
            pre_reveal_note,
            post_reveal_note,
            revealed_at,
            created_at,
            updated_at
          ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            ?6,
            ?7,
            NULL,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
        ",
        params![
          attempt_id,
          session_id,
          bottle_id,
          code,
          true_material_id,
          guessed_material_id,
          pre_reveal_note.map(|note| note.trim().to_string())
        ],
      )
      .map_err(|error| format!("failed to create attempt: {error}"))?;

    let (revealed_at, completed_attempts) = transaction
      .query_row(
        "
          SELECT
            revealed_at,
            (
              SELECT COUNT(*)
              FROM attempts
              WHERE session_id = ?1
            ) AS completed_attempts
          FROM attempts
          WHERE id = ?2
        ",
        params![session_id, attempt_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)),
      )
      .map_err(|error| format!("failed to load created attempt: {error}"))?;

    transaction
      .commit()
      .map_err(|error| format!("failed to commit attempt transaction: {error}"))?;

    Ok(RevealAttemptResult {
      attempt_id,
      session_id,
      code,
      true_material: MaterialSummary {
        id: true_material_id.clone(),
        name: true_material_name,
      },
      guessed_material: MaterialSummary {
        id: guessed_material_id_for_result.clone(),
        name: guessed_material_name,
      },
      is_correct: true_material_id == guessed_material_id_for_result,
      revealed_at,
      completed_attempts,
      target_batch_size,
    })
  }

  pub fn reveal_bottle_code(&self, code: u32) -> Result<BottleRevealResult, String> {
    validate_code_format(code)?;

    let connection = open_connection(&self.db_path)?;
    let (true_material_id, true_material_name) = connection
      .query_row(
        "
          SELECT materials.id, materials.name
          FROM bottles
          INNER JOIN materials ON materials.id = bottles.material_id
          WHERE bottles.code = ?1
            AND bottles.status = 'active'
          LIMIT 1
        ",
        params![code],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
      )
      .map_err(|error| format!("failed to resolve active bottle for reveal: {error}"))?;

    Ok(BottleRevealResult {
      code,
      true_material: MaterialSummary {
        id: true_material_id,
        name: true_material_name,
      },
    })
  }

  pub fn update_session_note(
    &self,
    session_id: String,
    session_note: Option<String>,
  ) -> Result<SessionNoteResult, String> {
    let connection = open_connection(&self.db_path)?;
    let trimmed_note = session_note
      .map(|note| note.trim().to_string())
      .filter(|note| !note.is_empty());

    connection
      .execute(
        "
          UPDATE sessions
          SET session_note = ?2,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?1
        ",
        params![session_id, trimmed_note],
      )
      .map_err(|error| format!("failed to update session note: {error}"))?;

    connection
      .query_row(
        "
          SELECT id, session_note, updated_at
          FROM sessions
          WHERE id = ?1
        ",
        params![session_id],
        |row| {
          Ok(SessionNoteResult {
            session_id: row.get(0)?,
            session_note: row.get(1)?,
            updated_at: row.get(2)?,
          })
        },
      )
      .map_err(|error| format!("failed to load updated session note: {error}"))
  }

  pub fn delete_session(&self, session_id: String) -> Result<DeletedSessionResult, String> {
    let mut connection = open_connection(&self.db_path)?;
    let transaction = connection
      .transaction()
      .map_err(|error| format!("failed to start session delete transaction: {error}"))?;

    let session_exists = transaction
      .query_row(
        "
          SELECT COUNT(*)
          FROM sessions
          WHERE id = ?1
        ",
        params![&session_id],
        |row| row.get::<_, u32>(0),
      )
      .map_err(|error| format!("failed to inspect session before delete: {error}"))?;

    if session_exists == 0 {
      return Err("session not found".into());
    }

    let deleted_entry_count = transaction
      .execute(
        "
          DELETE FROM session_entries
          WHERE session_id = ?1
        ",
        params![&session_id],
      )
      .map_err(|error| format!("failed to delete session entries: {error}"))? as u32;

    let deleted_attempt_count = transaction
      .execute(
        "
          DELETE FROM attempts
          WHERE session_id = ?1
        ",
        params![&session_id],
      )
      .map_err(|error| format!("failed to delete session attempts: {error}"))? as u32;

    let deleted_session_count = transaction
      .execute(
        "
          DELETE FROM sessions
          WHERE id = ?1
        ",
        params![&session_id],
      )
      .map_err(|error| format!("failed to delete session: {error}"))?;

    if deleted_session_count != 1 {
      return Err("session delete did not remove exactly one session".into());
    }

    transaction
      .commit()
      .map_err(|error| format!("failed to commit session delete: {error}"))?;

    Ok(DeletedSessionResult {
      session_id,
      deleted_attempt_count,
      deleted_entry_count,
    })
  }

  pub fn complete_session(
    &self,
    session_id: String,
    entries: Vec<SessionEntryInput>,
  ) -> Result<SessionCompletionResult, String> {
    if entries.is_empty() {
      return Err("capture at least one entry before completing the session".into());
    }

    let mut connection = open_connection(&self.db_path)?;
    let transaction = connection
      .transaction()
      .map_err(|error| format!("failed to start session completion transaction: {error}"))?;

    let target_batch_size = transaction
      .query_row(
        "
          SELECT target_batch_size
          FROM sessions
          WHERE id = ?1
            AND ended_at IS NULL
        ",
        params![&session_id],
        |row| row.get::<_, u32>(0),
      )
      .map_err(|error| format!("failed to load active session for completion: {error}"))?;

    if entries.len() as u32 > target_batch_size {
      return Err("session entries exceed the configured batch size".into());
    }

    let existing_entry_count = transaction
      .query_row(
        "
          SELECT COUNT(*)
          FROM session_entries
          WHERE session_id = ?1
        ",
        params![&session_id],
        |row| row.get::<_, u32>(0),
      )
      .map_err(|error| format!("failed to inspect existing session entries: {error}"))?;

    if existing_entry_count > 0 {
      return Err("session entries have already been completed for this session".into());
    }

    let existing_attempt_count = transaction
      .query_row(
        "
          SELECT COUNT(*)
          FROM attempts
          WHERE session_id = ?1
        ",
        params![&session_id],
        |row| row.get::<_, u32>(0),
      )
      .map_err(|error| format!("failed to inspect existing attempts: {error}"))?;

    if existing_attempt_count > 0 {
      return Err("attempts already exist for this session".into());
    }

    let mut seen_sequences = HashSet::new();
    let mut seen_codes = HashSet::new();
    let mut ordered_entries = entries;
    ordered_entries.sort_by_key(|entry| entry.sequence);

    let mut rows = Vec::with_capacity(ordered_entries.len());
    let mut correct_count = 0;
    let mut guessed_count = 0;
    let mut skipped_count = 0;

    for entry in ordered_entries {
      if !seen_sequences.insert(entry.sequence) {
        return Err("session entry sequence numbers must be unique".into());
      }

      let note = entry
        .pre_reveal_note
        .unwrap_or_default()
        .trim()
        .to_string();
      let stored_note = if note.is_empty() {
        None
      } else {
        Some(note.clone())
      };

      if let Some(code) = entry.code {
        validate_code_format(code)?;
        if !seen_codes.insert(code) {
          return Err("session entries cannot reuse the same bottle code".into());
        }
      }

      if !entry.skipped {
        let code = entry
          .code
          .ok_or_else(|| "guessed entries require a validated bottle code".to_string())?;
        let guessed_material_id = entry
          .guessed_material_id
          .clone()
          .ok_or_else(|| "guessed entries require a selected material".to_string())?;
        let revealed_at = current_timestamp(&transaction)?;

        let (bottle_id, dilution, true_material_id, true_material_name) = transaction
          .query_row(
            "
              SELECT bottles.id, bottles.dilution, materials.id, materials.name
              FROM bottles
              INNER JOIN materials ON materials.id = bottles.material_id
              WHERE bottles.code = ?1
                AND bottles.status = 'active'
              LIMIT 1
            ",
            params![code],
            |row| {
              Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
              ))
            },
          )
          .map_err(|error| format!("failed to resolve bottle for completed entry: {error}"))?;

        let guessed_material_name = transaction
          .query_row(
            "
              SELECT name
              FROM materials
              WHERE id = ?1
                AND status = 'active'
            ",
            params![&guessed_material_id],
            |row| row.get::<_, String>(0),
          )
          .map_err(|error| format!("failed to resolve guessed material for completed entry: {error}"))?;

        let is_correct = true_material_id == guessed_material_id;
        let attempt_id = generate_entity_id("attempt")?;
        transaction
          .execute(
            "
              INSERT INTO attempts (
                id,
                session_id,
                bottle_id,
                code_entered,
                material_id_at_reveal,
                guessed_material_id,
                pre_reveal_note,
                post_reveal_note,
                revealed_at,
                created_at,
                updated_at
              ) VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                NULL,
                ?8,
                ?8,
                ?8
              )
            ",
            params![
              attempt_id,
              &session_id,
              &bottle_id,
              code,
              &true_material_id,
              &guessed_material_id,
              &stored_note,
              &revealed_at,
            ],
          )
          .map_err(|error| format!("failed to create attempt during session completion: {error}"))?;

        let entry_id = generate_entity_id("session_entry")?;
        transaction
          .execute(
            "
              INSERT INTO session_entries (
                id,
                session_id,
                sequence_number,
                bottle_id,
                code_entered,
                dilution,
                true_material_id,
                guessed_material_id,
                status,
                pre_reveal_note,
                revealed_at,
                created_at,
                updated_at
              ) VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                ?8,
                ?9,
                ?10,
                ?11,
                ?11,
                ?11
              )
            ",
            params![
              entry_id,
              &session_id,
              entry.sequence,
              &bottle_id,
              code,
              &dilution,
              &true_material_id,
              &guessed_material_id,
              if is_correct { "match" } else { "mismatch" },
              &stored_note,
              &revealed_at,
            ],
          )
          .map_err(|error| format!("failed to persist completed session entry: {error}"))?;

        guessed_count += 1;
        if is_correct {
          correct_count += 1;
        }

        rows.push(SessionReportRow {
          sequence: entry.sequence,
          code: Some(code),
          guessed_material_name: Some(guessed_material_name),
          true_material_name,
          status: if is_correct { "match".into() } else { "mismatch".into() },
          note,
          revealed_at: Some(revealed_at),
        });

        continue;
      }

      skipped_count += 1;

      if let Some(code) = entry.code {
        let revealed_at = current_timestamp(&transaction)?;
        let (bottle_id, dilution, true_material_id, true_material_name) = transaction
          .query_row(
            "
              SELECT bottles.id, bottles.dilution, materials.id, materials.name
              FROM bottles
              INNER JOIN materials ON materials.id = bottles.material_id
              WHERE bottles.code = ?1
                AND bottles.status = 'active'
              LIMIT 1
            ",
            params![code],
            |row| {
              Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
              ))
            },
          )
          .map_err(|error| format!("failed to resolve skipped bottle for session completion: {error}"))?;

        let entry_id = generate_entity_id("session_entry")?;
        transaction
          .execute(
            "
              INSERT INTO session_entries (
                id,
                session_id,
                sequence_number,
                bottle_id,
                code_entered,
                dilution,
                true_material_id,
                guessed_material_id,
                status,
                pre_reveal_note,
                revealed_at,
                created_at,
                updated_at
              ) VALUES (
                ?1,
                ?2,
                ?3,
                ?4,
                ?5,
                ?6,
                ?7,
                NULL,
                'skipped',
                ?8,
                ?9,
                ?9,
                ?9
              )
            ",
            params![
              entry_id,
              &session_id,
              entry.sequence,
              &bottle_id,
              code,
              &dilution,
              &true_material_id,
              &stored_note,
              &revealed_at,
            ],
          )
          .map_err(|error| format!("failed to persist skipped session entry: {error}"))?;

        rows.push(SessionReportRow {
          sequence: entry.sequence,
          code: Some(code),
          guessed_material_name: None,
          true_material_name,
          status: "skipped".into(),
          note,
          revealed_at: Some(revealed_at),
        });

        continue;
      }

      let entry_id = generate_entity_id("session_entry")?;
      let created_at = current_timestamp(&transaction)?;
      transaction
        .execute(
          "
            INSERT INTO session_entries (
              id,
              session_id,
              sequence_number,
              bottle_id,
              code_entered,
              dilution,
              true_material_id,
              guessed_material_id,
              status,
              pre_reveal_note,
              revealed_at,
              created_at,
              updated_at
            ) VALUES (
              ?1,
              ?2,
              ?3,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              'skipped',
              ?4,
              NULL,
              ?5,
              ?5
            )
          ",
          params![entry_id, &session_id, entry.sequence, &stored_note, &created_at],
        )
        .map_err(|error| format!("failed to persist skipped empty session entry: {error}"))?;

      rows.push(SessionReportRow {
        sequence: entry.sequence,
        code: None,
        guessed_material_name: None,
        true_material_name: "Not entered".into(),
        status: "skipped".into(),
        note,
        revealed_at: None,
      });
    }

    let completed_at = current_timestamp(&transaction)?;
    transaction
      .execute(
        "
          UPDATE sessions
          SET ended_at = ?2,
              updated_at = ?2
          WHERE id = ?1
        ",
        params![&session_id, &completed_at],
      )
      .map_err(|error| format!("failed to close completed session: {error}"))?;

    transaction
      .commit()
      .map_err(|error| format!("failed to commit completed session: {error}"))?;

    Ok(SessionCompletionResult {
      rows,
      correct_count,
      guessed_count,
      skipped_count,
      completed_at,
    })
  }

  pub fn get_performance_snapshot(&self) -> Result<PerformanceSnapshot, String> {
    let connection = open_connection(&self.db_path)?;

    let mut session_statement = connection
      .prepare(
        "
          SELECT
            id,
            started_at,
            ended_at,
            target_batch_size,
            session_note
          FROM sessions
          ORDER BY started_at DESC
        ",
      )
      .map_err(|error| format!("failed to prepare performance sessions query: {error}"))?;

    let session_rows = session_statement
      .query_map([], |row| {
        Ok(PerformanceSessionRecord {
          session_id: row.get(0)?,
          started_at: row.get(1)?,
          ended_at: row.get(2)?,
          target_batch_size: row.get(3)?,
          session_note: row.get(4)?,
        })
      })
      .map_err(|error| format!("failed to query performance sessions: {error}"))?;

    let sessions = session_rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to collect performance sessions: {error}"))?;

    let mut attempt_statement = connection
      .prepare(
        "
          SELECT
            attempts.id,
            attempts.session_id,
            attempts.bottle_id,
            attempts.code_entered,
            bottles.dilution,
            true_materials.id,
            true_materials.name,
            guessed_materials.id,
            guessed_materials.name,
            CASE
              WHEN attempts.guessed_material_id = attempts.material_id_at_reveal THEN 1
              ELSE 0
            END AS is_correct,
            attempts.pre_reveal_note,
            attempts.revealed_at
          FROM attempts
          INNER JOIN bottles ON bottles.id = attempts.bottle_id
          INNER JOIN materials AS true_materials
            ON true_materials.id = attempts.material_id_at_reveal
          INNER JOIN materials AS guessed_materials
            ON guessed_materials.id = attempts.guessed_material_id
          ORDER BY attempts.revealed_at DESC
        ",
      )
      .map_err(|error| format!("failed to prepare performance attempts query: {error}"))?;

    let attempt_rows = attempt_statement
      .query_map([], |row| {
        Ok(PerformanceAttemptRecord {
          attempt_id: row.get(0)?,
          session_id: row.get(1)?,
          bottle_id: row.get(2)?,
          bottle_code: row.get(3)?,
          dilution: row.get(4)?,
          true_material_id: row.get(5)?,
          true_material_name: row.get(6)?,
          guessed_material_id: row.get(7)?,
          guessed_material_name: row.get(8)?,
          is_correct: row.get::<_, i64>(9)? == 1,
          pre_reveal_note: row.get(10)?,
          revealed_at: row.get(11)?,
        })
      })
      .map_err(|error| format!("failed to query performance attempts: {error}"))?;

    let attempts = attempt_rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to collect performance attempts: {error}"))?;

    let mut session_entry_statement = connection
      .prepare(
        "
          SELECT
            session_entries.id,
            session_entries.session_id,
            session_entries.sequence_number,
            session_entries.bottle_id,
            session_entries.code_entered,
            session_entries.dilution,
            true_materials.id,
            true_materials.name,
            guessed_materials.id,
            guessed_materials.name,
            session_entries.status,
            session_entries.pre_reveal_note,
            session_entries.revealed_at
          FROM session_entries
          LEFT JOIN materials AS true_materials
            ON true_materials.id = session_entries.true_material_id
          LEFT JOIN materials AS guessed_materials
            ON guessed_materials.id = session_entries.guessed_material_id
          ORDER BY session_entries.session_id ASC, session_entries.sequence_number ASC
        ",
      )
      .map_err(|error| format!("failed to prepare performance session entries query: {error}"))?;

    let session_entry_rows = session_entry_statement
      .query_map([], |row| {
        Ok(PerformanceSessionEntryRecord {
          entry_id: row.get(0)?,
          session_id: row.get(1)?,
          sequence: row.get(2)?,
          bottle_id: row.get(3)?,
          bottle_code: row.get(4)?,
          dilution: row.get(5)?,
          true_material_id: row.get(6)?,
          true_material_name: row.get(7)?,
          guessed_material_id: row.get(8)?,
          guessed_material_name: row.get(9)?,
          status: row.get(10)?,
          pre_reveal_note: row.get(11)?,
          revealed_at: row.get(12)?,
        })
      })
      .map_err(|error| format!("failed to query performance session entries: {error}"))?;

    let entries = session_entry_rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to collect performance session entries: {error}"))?;

    Ok(PerformanceSnapshot {
      sessions,
      attempts,
      entries,
    })
  }

  pub fn list_inventory_materials(&self) -> Result<MaterialInventoryListResult, String> {
    let connection = open_connection(&self.db_path)?;
    let mut statement = connection
      .prepare(
        "
          SELECT
            materials.id,
            materials.name,
            materials.status,
            COUNT(DISTINCT CASE WHEN bottles.status = 'active' THEN bottles.id END),
            COUNT(DISTINCT CASE WHEN bottles.status = 'archived' THEN bottles.id END),
            COUNT(DISTINCT attempts.id),
            materials.created_at,
            materials.updated_at
          FROM materials
          LEFT JOIN bottles ON bottles.material_id = materials.id
          LEFT JOIN attempts ON attempts.bottle_id = bottles.id
          GROUP BY materials.id
          ORDER BY
            CASE materials.status WHEN 'active' THEN 0 ELSE 1 END,
            lower(materials.name) ASC
        ",
      )
      .map_err(|error| format!("failed to prepare inventory materials query: {error}"))?;

    let rows = statement
      .query_map([], |row| {
        Ok(MaterialInventoryItem {
          id: row.get(0)?,
          name: row.get(1)?,
          status: row.get(2)?,
          active_bottle_count: row.get(3)?,
          archived_bottle_count: row.get(4)?,
          attempt_count: row.get(5)?,
          created_at: row.get(6)?,
          updated_at: row.get(7)?,
        })
      })
      .map_err(|error| format!("failed to query inventory materials: {error}"))?;

    let items = rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to collect inventory materials: {error}"))?;

    Ok(MaterialInventoryListResult { items })
  }

  pub fn create_inventory_material(
    &self,
    name: String,
  ) -> Result<MaterialInventoryItem, String> {
    let connection = open_connection(&self.db_path)?;
    let display_name = sanitize_material_name(&name)?;
    let normalized_name = normalize_material_name(&display_name);

    ensure_material_name_available(&connection, &normalized_name, None)?;

    let material_id = generate_entity_id("material")?;
    connection
      .execute(
        "
          INSERT INTO materials (
            id,
            name,
            normalized_name,
            status,
            created_at,
            updated_at
          ) VALUES (
            ?1,
            ?2,
            ?3,
            'active',
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
        ",
        params![material_id, display_name, normalized_name],
      )
      .map_err(|error| format!("failed to create material: {error}"))?;

    fetch_material_inventory_item(&connection, &material_id)
  }

  pub fn update_inventory_material(
    &self,
    material_id: String,
    name: String,
    status: String,
  ) -> Result<MaterialInventoryItem, String> {
    let connection = open_connection(&self.db_path)?;
    validate_entity_status(&status)?;

    let display_name = sanitize_material_name(&name)?;
    let normalized_name = normalize_material_name(&display_name);

    ensure_material_exists(&connection, &material_id)?;
    ensure_material_name_available(&connection, &normalized_name, Some(&material_id))?;

    if status == "archived" {
      ensure_material_has_no_active_bottles(&connection, &material_id)?;
    }

    connection
      .execute(
        "
          UPDATE materials
          SET name = ?2,
              normalized_name = ?3,
              status = ?4,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?1
        ",
        params![material_id, display_name, normalized_name, status],
      )
      .map_err(|error| format!("failed to update material: {error}"))?;

    fetch_material_inventory_item(&connection, &material_id)
  }

  pub fn archive_inventory_material(
    &self,
    material_id: String,
  ) -> Result<MaterialInventoryItem, String> {
    let connection = open_connection(&self.db_path)?;

    ensure_material_exists(&connection, &material_id)?;
    ensure_material_has_no_active_bottles(&connection, &material_id)?;

    connection
      .execute(
        "
          UPDATE materials
          SET status = 'archived',
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?1
        ",
        params![material_id],
      )
      .map_err(|error| format!("failed to archive material: {error}"))?;

    fetch_material_inventory_item(&connection, &material_id)
  }

  pub fn list_inventory_bottles(&self) -> Result<BottleInventoryListResult, String> {
    let connection = open_connection(&self.db_path)?;
    let mut statement = connection
      .prepare(
        "
          SELECT
            bottles.id,
            bottles.material_id,
            materials.name,
            materials.status,
            bottles.code,
            bottles.dilution,
            bottles.status,
            bottles.created_at,
            bottles.updated_at,
            bottles.archived_at
          FROM bottles
          INNER JOIN materials ON materials.id = bottles.material_id
          ORDER BY
            CASE bottles.status WHEN 'active' THEN 0 ELSE 1 END,
            bottles.code ASC
        ",
      )
      .map_err(|error| format!("failed to prepare inventory bottles query: {error}"))?;

    let rows = statement
      .query_map([], |row| {
        Ok(BottleInventoryItem {
          id: row.get(0)?,
          material_id: row.get(1)?,
          material_name: row.get(2)?,
          material_status: row.get(3)?,
          code: row.get(4)?,
          dilution: row.get(5)?,
          status: row.get(6)?,
          created_at: row.get(7)?,
          updated_at: row.get(8)?,
          archived_at: row.get(9)?,
        })
      })
      .map_err(|error| format!("failed to query inventory bottles: {error}"))?;

    let items = rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("failed to collect inventory bottles: {error}"))?;

    Ok(BottleInventoryListResult { items })
  }

  pub fn generate_inventory_bottle_code(&self) -> Result<GeneratedBottleCodeResult, String> {
    let connection = open_connection(&self.db_path)?;
    let used_codes = load_existing_bottles(&connection)?
      .into_keys()
      .collect::<HashSet<_>>();

    let available_codes = (100..=999)
      .filter(|code| validate_assignable_code(*code).is_ok() && !used_codes.contains(code))
      .collect::<Vec<_>>();

    if available_codes.is_empty() {
      return Err("no assignable bottle codes remain".into());
    }

    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map_err(|error| format!("failed to generate bottle code timestamp: {error}"))?;
    let index = (timestamp.subsec_nanos() as usize) % available_codes.len();
    let code = available_codes[index];

    Ok(GeneratedBottleCodeResult {
      code,
      remaining_assignable_codes: available_codes.len().saturating_sub(1) as u32,
    })
  }

  pub fn create_inventory_bottle(
    &self,
    material_id: String,
    code: u32,
    dilution: String,
  ) -> Result<BottleInventoryItem, String> {
    let connection = open_connection(&self.db_path)?;
    validate_assignable_code(code)?;
    ensure_active_material(&connection, &material_id)?;
    ensure_code_available(&connection, code, None)?;
    let sanitized_dilution = sanitize_required_text(&dilution, "dilution")?;

    let bottle_id = generate_entity_id("bottle")?;
    connection
      .execute(
        "
          INSERT INTO bottles (
            id,
            material_id,
            code,
            dilution,
            status,
            created_at,
            updated_at,
            archived_at
          ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            'active',
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            NULL
          )
        ",
        params![bottle_id, material_id, code, sanitized_dilution],
      )
      .map_err(|error| format!("failed to create bottle: {error}"))?;

    fetch_bottle_inventory_item(&connection, &bottle_id)
  }

  pub fn update_inventory_bottle(
    &self,
    bottle_id: String,
    material_id: String,
    code: u32,
    dilution: String,
    status: String,
  ) -> Result<BottleInventoryItem, String> {
    let mut connection = open_connection(&self.db_path)?;
    validate_entity_status(&status)?;
    validate_assignable_code(code)?;
    let sanitized_dilution = sanitize_required_text(&dilution, "dilution")?;

    let transaction = connection
      .transaction()
      .map_err(|error| format!("failed to start bottle update transaction: {error}"))?;

    let (previous_material_id, previous_status) = transaction
      .query_row(
        "
          SELECT material_id, status
          FROM bottles
          WHERE id = ?1
        ",
        params![bottle_id],
        |row| {
          Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
          ))
        },
      )
      .map_err(|error| format!("failed to load bottle for update: {error}"))?;

    if status == "active" {
      ensure_active_material(&transaction, &material_id)?;
    } else {
      ensure_material_exists(&transaction, &material_id)?;
    }

    ensure_code_available(&transaction, code, Some(&bottle_id))?;

    transaction
      .execute(
        "
          UPDATE bottles
          SET material_id = ?2,
              code = ?3,
              dilution = ?4,
              status = ?5,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              archived_at = CASE
                WHEN ?5 = 'archived' AND (?6 != 'archived' OR archived_at IS NULL)
                  THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHEN ?5 = 'active' THEN NULL
                ELSE archived_at
              END
          WHERE id = ?1
        ",
        params![
          bottle_id,
          material_id,
          code,
          sanitized_dilution,
          status,
          previous_status
        ],
      )
      .map_err(|error| format!("failed to update bottle: {error}"))?;

    if previous_material_id != material_id {
      transaction
        .execute(
          "
            INSERT INTO bottle_assignment_audit (
              id,
              bottle_id,
              old_material_id,
              new_material_id,
              reason,
              changed_at
            ) VALUES (
              ?1,
              ?2,
              ?3,
              ?4,
              'Manual inventory update',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            )
          ",
          params![
            generate_entity_id("bottle_assignment")?,
            bottle_id,
            previous_material_id,
            material_id
          ],
        )
        .map_err(|error| format!("failed to log bottle mapping change: {error}"))?;
    }

    let result = fetch_bottle_inventory_item(&transaction, &bottle_id)?;
    transaction
      .commit()
      .map_err(|error| format!("failed to commit bottle update: {error}"))?;

    Ok(result)
  }

  pub fn archive_inventory_bottle(
    &self,
    bottle_id: String,
  ) -> Result<BottleInventoryItem, String> {
    let connection = open_connection(&self.db_path)?;

    ensure_bottle_exists(&connection, &bottle_id)?;

    connection
      .execute(
        "
          UPDATE bottles
          SET status = 'archived',
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              archived_at = COALESCE(
                archived_at,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              )
          WHERE id = ?1
        ",
        params![bottle_id],
      )
      .map_err(|error| format!("failed to archive bottle: {error}"))?;

    fetch_bottle_inventory_item(&connection, &bottle_id)
  }

  pub fn preview_materials_import(
    &self,
    file_path: String,
  ) -> Result<MaterialsImportSummary, String> {
    let connection = open_connection(&self.db_path)?;
    let analysis = analyze_materials_import(&connection, &file_path)?;

    Ok(MaterialsImportSummary {
      rows_read: analysis.rows_read,
      creates: analysis.new_materials.len() as u32,
      duplicates_skipped: analysis.duplicates_skipped,
      errors: analysis.errors,
      committed: false,
    })
  }

  pub fn commit_materials_import(
    &self,
    file_path: String,
  ) -> Result<MaterialsImportSummary, String> {
    let mut connection = open_connection(&self.db_path)?;
    let analysis = analyze_materials_import(&connection, &file_path)?;

    let mut summary = MaterialsImportSummary {
      rows_read: analysis.rows_read,
      creates: analysis.new_materials.len() as u32,
      duplicates_skipped: analysis.duplicates_skipped,
      errors: analysis.errors,
      committed: false,
    };

    if summary.errors.is_empty() {
      let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start materials import transaction: {error}"))?;

      for material in &analysis.new_materials {
        transaction
          .execute(
            "
              INSERT INTO materials (
                id,
                name,
                normalized_name,
                status,
                created_at,
                updated_at
              ) VALUES (
                ?1,
                ?2,
                ?3,
                'active',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              )
            ",
            params![
              generate_entity_id("material")?,
              material.display_name,
              material.normalized_name
            ],
          )
          .map_err(|error| format!("failed to insert imported material: {error}"))?;
      }

      log_import(
        &transaction,
        "materials_csv",
        "append_only",
        &file_path,
        "committed",
        &summary,
      )?;

      transaction
        .commit()
        .map_err(|error| format!("failed to commit materials import: {error}"))?;

      summary.committed = true;
    } else {
      log_import_failure(
        &connection,
        "materials_csv",
        "append_only",
        &file_path,
        &summary,
      )?;
    }

    Ok(summary)
  }

  pub fn preview_bottles_import(
    &self,
    file_path: String,
    mode: String,
  ) -> Result<BottlesImportSummary, String> {
    let connection = open_connection(&self.db_path)?;
    let analysis = analyze_bottles_import(&connection, &file_path, &mode)?;

    Ok(BottlesImportSummary {
      mode: analysis.mode.as_str().into(),
      rows_read: analysis.rows_read,
      create_materials: analysis.new_materials.len() as u32,
      create_bottles: analysis
        .actions
        .iter()
        .filter(|action| matches!(action, PlannedBottleAction::Create { .. }))
        .count() as u32,
      update_bottles: analysis
        .actions
        .iter()
        .filter(|action| matches!(action, PlannedBottleAction::Update { .. }))
        .count() as u32,
      errors: analysis.errors,
      committed: false,
    })
  }

  pub fn commit_bottles_import(
    &self,
    file_path: String,
    mode: String,
  ) -> Result<BottlesImportSummary, String> {
    let mut connection = open_connection(&self.db_path)?;
    let analysis = analyze_bottles_import(&connection, &file_path, &mode)?;

    let mut summary = BottlesImportSummary {
      mode: analysis.mode.as_str().into(),
      rows_read: analysis.rows_read,
      create_materials: analysis.new_materials.len() as u32,
      create_bottles: analysis
        .actions
        .iter()
        .filter(|action| matches!(action, PlannedBottleAction::Create { .. }))
        .count() as u32,
      update_bottles: analysis
        .actions
        .iter()
        .filter(|action| matches!(action, PlannedBottleAction::Update { .. }))
        .count() as u32,
      errors: analysis.errors,
      committed: false,
    };

    if summary.errors.is_empty() {
      let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start bottles import transaction: {error}"))?;

      let mut material_ids = load_existing_materials(&transaction)?;
      for material in &analysis.new_materials {
        let material_id = generate_entity_id("material")?;
        transaction
          .execute(
            "
              INSERT INTO materials (
                id,
                name,
                normalized_name,
                status,
                created_at,
                updated_at
              ) VALUES (
                ?1,
                ?2,
                ?3,
                'active',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              )
            ",
            params![material_id, material.display_name, material.normalized_name],
          )
          .map_err(|error| format!("failed to insert imported bottle material: {error}"))?;

        material_ids.insert(
          material.normalized_name.clone(),
          ExistingMaterial {
            id: material_id,
          },
        );
      }

      for action in &analysis.actions {
        match action {
          PlannedBottleAction::Create {
            code,
            dilution,
            normalized_name,
          } => {
            let material_id = material_ids
              .get(normalized_name)
              .map(|material| material.id.clone())
              .ok_or_else(|| "failed to resolve imported material for bottle".to_string())?;

            transaction
              .execute(
                "
                  INSERT INTO bottles (
                    id,
                    material_id,
                    code,
                    dilution,
                    status,
                    created_at,
                    updated_at,
                    archived_at
                  ) VALUES (
                    ?1,
                    ?2,
                    ?3,
                    ?4,
                    'active',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                    NULL
                  )
                ",
                params![generate_entity_id("bottle")?, material_id, code, dilution],
              )
              .map_err(|error| format!("failed to insert imported bottle: {error}"))?;
          }
          PlannedBottleAction::Update {
            code,
            dilution,
            normalized_name,
            previous_material_id,
          } => {
            let material_id = material_ids
              .get(normalized_name)
              .map(|material| material.id.clone())
              .ok_or_else(|| "failed to resolve imported material for bottle update".to_string())?;

            transaction
              .execute(
                "
                  UPDATE bottles
                  SET material_id = ?1,
                      dilution = ?2,
                      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE code = ?3
                ",
                params![material_id, dilution, code],
              )
              .map_err(|error| format!("failed to update imported bottle: {error}"))?;

            if &material_id != previous_material_id {
              transaction
                .execute(
                  "
                    INSERT INTO bottle_assignment_audit (
                      id,
                      bottle_id,
                      old_material_id,
                      new_material_id,
                      reason,
                      changed_at
                    )
                    SELECT
                      ?1,
                      id,
                      ?2,
                      ?3,
                      'CSV import upsert by code',
                      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    FROM bottles
                    WHERE code = ?4
                  ",
                  params![
                    generate_entity_id("bottle_assignment")?,
                    previous_material_id,
                    material_id,
                    code
                  ],
                )
                .map_err(|error| format!("failed to log bottle mapping update: {error}"))?;
            }
          }
        }
      }

      log_import(
        &transaction,
        "bottles_csv",
        analysis.mode.as_str(),
        &file_path,
        "committed",
        &summary,
      )?;

      transaction
        .commit()
        .map_err(|error| format!("failed to commit bottles import: {error}"))?;

      summary.committed = true;
    } else {
      log_import_failure(
        &connection,
        "bottles_csv",
        analysis.mode.as_str(),
        &file_path,
        &summary,
      )?;
    }

    Ok(summary)
  }
}

fn open_connection(path: &Path) -> Result<Connection, String> {
  let connection =
    Connection::open(path).map_err(|error| format!("failed to open database: {error}"))?;

  connection
    .pragma_update(None, "foreign_keys", 1)
    .map_err(|error| format!("failed to enable foreign keys: {error}"))?;

  Ok(connection)
}

fn run_migrations(connection: &Connection) -> Result<(), String> {
  let current_version = read_user_version(connection)?;

  if current_version >= SCHEMA_VERSION {
    return Ok(());
  }

  if current_version < 1 {
    connection
      .execute_batch(INITIAL_MIGRATION)
      .map_err(|error| format!("failed to apply initial schema migration: {error}"))?;

    connection
      .pragma_update(None, "user_version", SCHEMA_VERSION)
      .map_err(|error| format!("failed to update schema version: {error}"))?;

    return Ok(());
  }

  if current_version < 2 {
    connection
      .execute_batch(ATTEMPT_TRUTH_MIGRATION)
      .map_err(|error| format!("failed to apply attempt truth migration: {error}"))?;
  }

  if current_version < 3 {
    connection
      .execute_batch(SESSION_ENTRY_MIGRATION)
      .map_err(|error| format!("failed to apply session entry migration: {error}"))?;
  }

  connection
    .pragma_update(None, "user_version", SCHEMA_VERSION)
    .map_err(|error| format!("failed to update schema version: {error}"))?;

  Ok(())
}

fn read_user_version(connection: &Connection) -> Result<u32, String> {
  connection
    .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
    .map_err(|error| format!("failed to read schema version: {error}"))
}

fn current_timestamp(connection: &Connection) -> Result<String, String> {
  connection
    .query_row(
      "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      [],
      |row| row.get::<_, String>(0),
    )
    .map_err(|error| format!("failed to generate current timestamp: {error}"))
}

fn generate_entity_id(prefix: &str) -> Result<String, String> {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|error| format!("failed to generate session id timestamp: {error}"))?;

  Ok(format!("{prefix}_{}", timestamp.as_nanos()))
}

fn generate_session_id() -> Result<String, String> {
  generate_entity_id("session")
}

fn validate_code_format(code: u32) -> Result<(), String> {
  if !(100..=999).contains(&code) {
    return Err("bottle code must be a 3-digit number between 100 and 999".into());
  }

  Ok(())
}

fn validate_assignable_code(code: u32) -> Result<(), String> {
  validate_code_format(code)?;

  let hundreds = (code / 100) as i32;
  let tens = ((code / 10) % 10) as i32;
  let ones = (code % 10) as i32;

  if hundreds == tens && tens == ones {
    return Err("code uses a disallowed repeated pattern".into());
  }

  if tens == hundreds + 1 && ones == tens + 1 {
    return Err("code uses a disallowed ascending sequence".into());
  }

  if tens == hundreds - 1 && ones == tens - 1 {
    return Err("code uses a disallowed descending sequence".into());
  }

  Ok(())
}

fn normalize_material_name(name: &str) -> String {
  name.split_whitespace()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase()
}

fn load_existing_materials(
  connection: &Connection,
) -> Result<HashMap<String, ExistingMaterial>, String> {
  let mut statement = connection
    .prepare("SELECT id, normalized_name FROM materials")
    .map_err(|error| format!("failed to prepare material lookup: {error}"))?;

  let mapped_rows = statement
    .query_map([], |row| {
      Ok((
        row.get::<_, String>(1)?,
        ExistingMaterial {
          id: row.get(0)?,
        },
      ))
    })
    .map_err(|error| format!("failed to load existing materials: {error}"))?;

  mapped_rows
    .collect::<Result<HashMap<_, _>, _>>()
    .map_err(|error| format!("failed to collect existing materials: {error}"))
}

fn load_existing_bottles(connection: &Connection) -> Result<HashMap<u32, ExistingBottle>, String> {
  let mut statement = connection
    .prepare("SELECT code, material_id, status FROM bottles")
    .map_err(|error| format!("failed to prepare bottle lookup: {error}"))?;

  let mapped_rows = statement
    .query_map([], |row| {
      Ok((
        row.get::<_, u32>(0)?,
        ExistingBottle {
          material_id: row.get(1)?,
          status: row.get(2)?,
        },
      ))
    })
    .map_err(|error| format!("failed to load existing bottles: {error}"))?;

  mapped_rows
    .collect::<Result<HashMap<_, _>, _>>()
    .map_err(|error| format!("failed to collect existing bottles: {error}"))
}

fn sanitize_required_text(value: &str, field_name: &str) -> Result<String, String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return Err(format!("{field_name} is required"));
  }

  Ok(trimmed.to_string())
}

fn sanitize_material_name(name: &str) -> Result<String, String> {
  let normalized_whitespace = name
    .split_whitespace()
    .filter(|segment| !segment.is_empty())
    .collect::<Vec<_>>()
    .join(" ");

  if normalized_whitespace.is_empty() {
    return Err("material name is required".into());
  }

  Ok(normalized_whitespace)
}

fn validate_entity_status(status: &str) -> Result<(), String> {
  match status {
    "active" | "archived" => Ok(()),
    _ => Err("status must be either 'active' or 'archived'".into()),
  }
}

fn ensure_material_exists(connection: &Connection, material_id: &str) -> Result<(), String> {
  let exists = connection
    .query_row(
      "SELECT 1 FROM materials WHERE id = ?1 LIMIT 1",
      params![material_id],
      |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|error| format!("failed to verify material: {error}"))?;

  if exists.is_none() {
    return Err("material not found".into());
  }

  Ok(())
}

fn ensure_active_material(connection: &Connection, material_id: &str) -> Result<(), String> {
  let status = connection
    .query_row(
      "SELECT status FROM materials WHERE id = ?1",
      params![material_id],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| format!("failed to load material status: {error}"))?;

  match status.as_deref() {
    Some("active") => Ok(()),
    Some("archived") => Err("active bottles must point to an active material".into()),
    None => Err("material not found".into()),
    Some(_) => Err("material status is invalid".into()),
  }
}

fn ensure_bottle_exists(connection: &Connection, bottle_id: &str) -> Result<(), String> {
  let exists = connection
    .query_row(
      "SELECT 1 FROM bottles WHERE id = ?1 LIMIT 1",
      params![bottle_id],
      |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|error| format!("failed to verify bottle: {error}"))?;

  if exists.is_none() {
    return Err("bottle not found".into());
  }

  Ok(())
}

fn ensure_material_name_available(
  connection: &Connection,
  normalized_name: &str,
  exclude_material_id: Option<&str>,
) -> Result<(), String> {
  let existing_id = connection
    .query_row(
      "SELECT id FROM materials WHERE normalized_name = ?1 LIMIT 1",
      params![normalized_name],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| format!("failed to check material uniqueness: {error}"))?;

  if let Some(existing_id) = existing_id {
    if Some(existing_id.as_str()) != exclude_material_id {
      return Err("a material with this normalized name already exists".into());
    }
  }

  Ok(())
}

fn ensure_material_has_no_active_bottles(
  connection: &Connection,
  material_id: &str,
) -> Result<(), String> {
  let active_bottle_count = connection
    .query_row(
      "
        SELECT COUNT(*)
        FROM bottles
        WHERE material_id = ?1
          AND status = 'active'
      ",
      params![material_id],
      |row| row.get::<_, u32>(0),
    )
    .map_err(|error| format!("failed to check material bottle count: {error}"))?;

  if active_bottle_count > 0 {
    return Err("archive or move active bottles before archiving this material".into());
  }

  Ok(())
}

fn ensure_code_available(
  connection: &Connection,
  code: u32,
  exclude_bottle_id: Option<&str>,
) -> Result<(), String> {
  let existing_bottle_id = connection
    .query_row(
      "SELECT id FROM bottles WHERE code = ?1 LIMIT 1",
      params![code],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| format!("failed to check bottle code availability: {error}"))?;

  if let Some(existing_bottle_id) = existing_bottle_id {
    if Some(existing_bottle_id.as_str()) != exclude_bottle_id {
      return Err("bottle code already exists and remains reserved".into());
    }
  }

  Ok(())
}

fn fetch_material_inventory_item(
  connection: &Connection,
  material_id: &str,
) -> Result<MaterialInventoryItem, String> {
  connection
    .query_row(
      "
        SELECT
          materials.id,
          materials.name,
          materials.status,
          (
            SELECT COUNT(*)
            FROM bottles
            WHERE bottles.material_id = materials.id
              AND bottles.status = 'active'
          ) AS active_bottle_count,
          (
            SELECT COUNT(*)
            FROM bottles
            WHERE bottles.material_id = materials.id
              AND bottles.status = 'archived'
          ) AS archived_bottle_count,
          (
            SELECT COUNT(*)
            FROM attempts
            INNER JOIN bottles ON bottles.id = attempts.bottle_id
            WHERE bottles.material_id = materials.id
          ) AS attempt_count,
          materials.created_at,
          materials.updated_at
        FROM materials
        WHERE materials.id = ?1
      ",
      params![material_id],
      |row| {
        Ok(MaterialInventoryItem {
          id: row.get(0)?,
          name: row.get(1)?,
          status: row.get(2)?,
          active_bottle_count: row.get(3)?,
          archived_bottle_count: row.get(4)?,
          attempt_count: row.get(5)?,
          created_at: row.get(6)?,
          updated_at: row.get(7)?,
        })
      },
    )
    .map_err(|error| format!("failed to load material: {error}"))
}

fn fetch_bottle_inventory_item(
  connection: &Connection,
  bottle_id: &str,
) -> Result<BottleInventoryItem, String> {
  connection
    .query_row(
      "
        SELECT
          bottles.id,
          bottles.material_id,
          materials.name,
          materials.status,
          bottles.code,
          bottles.dilution,
          bottles.status,
          bottles.created_at,
          bottles.updated_at,
          bottles.archived_at
        FROM bottles
        INNER JOIN materials ON materials.id = bottles.material_id
        WHERE bottles.id = ?1
      ",
      params![bottle_id],
      |row| {
        Ok(BottleInventoryItem {
          id: row.get(0)?,
          material_id: row.get(1)?,
          material_name: row.get(2)?,
          material_status: row.get(3)?,
          code: row.get(4)?,
          dilution: row.get(5)?,
          status: row.get(6)?,
          created_at: row.get(7)?,
          updated_at: row.get(8)?,
          archived_at: row.get(9)?,
        })
      },
    )
    .map_err(|error| format!("failed to load bottle: {error}"))
}

fn analyze_materials_import(
  connection: &Connection,
  file_path: &str,
) -> Result<MaterialsImportAnalysis, String> {
  let resolved_path = resolve_import_path(file_path)?;
  let existing_materials = load_existing_materials(connection)?;
  let mut reader = csv::ReaderBuilder::new()
    .flexible(true)
    .from_path(&resolved_path)
    .map_err(|error| format!("failed to open materials CSV: {error}"))?;

  let headers = reader
    .headers()
    .map_err(|error| format!("failed to read materials CSV headers: {error}"))?
    .clone();
  let name_index = resolve_header_index(&headers, &["name"])
    .ok_or_else(|| "materials CSV requires a 'name' column".to_string())?;

  let mut seen_names = HashSet::new();
  let mut duplicates_skipped = 0;
  let mut errors = Vec::new();
  let mut new_materials = Vec::new();
  let mut rows_read = 0;

  for (index, row) in reader.records().enumerate() {
    rows_read += 1;
    let row_number = (index + 2) as u32;
    let record = match row {
      Ok(record) => record,
      Err(error) => {
        errors.push(ImportIssue {
          row: row_number,
          message: format!("failed to parse CSV row: {error}"),
        });
        continue;
      }
    };

    let name = record.get(name_index).unwrap_or("").trim();
    if name.is_empty() {
      errors.push(ImportIssue {
        row: row_number,
        message: "missing material name".into(),
      });
      continue;
    }

    let normalized_name = normalize_material_name(name);
    if !seen_names.insert(normalized_name.clone()) || existing_materials.contains_key(&normalized_name)
    {
      duplicates_skipped += 1;
      continue;
    }

    new_materials.push(PlannedMaterial {
      normalized_name,
      display_name: name.to_string(),
    });
  }

  Ok(MaterialsImportAnalysis {
    rows_read,
    duplicates_skipped,
    errors,
    new_materials,
  })
}

fn analyze_bottles_import(
  connection: &Connection,
  file_path: &str,
  mode: &str,
) -> Result<BottlesImportAnalysis, String> {
  let resolved_path = resolve_import_path(file_path)?;
  let import_mode = ImportMode::parse(mode)?;
  let existing_materials = load_existing_materials(connection)?;
  let existing_bottles = load_existing_bottles(connection)?;

  let mut reader = csv::ReaderBuilder::new()
    .flexible(true)
    .from_path(&resolved_path)
    .map_err(|error| format!("failed to open bottles CSV: {error}"))?;

  let headers = reader
    .headers()
    .map_err(|error| format!("failed to read bottles CSV headers: {error}"))?
    .clone();
  let material_index = resolve_header_index(&headers, &["material name"])
    .ok_or_else(|| "bottles CSV requires a 'Material Name' column".to_string())?;
  let code_index = resolve_header_index(&headers, &["code"])
    .ok_or_else(|| "bottles CSV requires a 'Code' column".to_string())?;
  let dilution_index = resolve_header_index(&headers, &["dillution", "dilution"])
    .ok_or_else(|| "bottles CSV requires a 'Dillution' or 'Dilution' column".to_string())?;

  let mut seen_codes = HashSet::new();
  let mut planned_materials = HashMap::<String, PlannedMaterial>::new();
  let mut actions = Vec::new();
  let mut errors = Vec::new();
  let mut rows_read = 0;

  for (index, row) in reader.records().enumerate() {
    rows_read += 1;
    let row_number = (index + 2) as u32;
    let record = match row {
      Ok(record) => record,
      Err(error) => {
        errors.push(ImportIssue {
          row: row_number,
          message: format!("failed to parse CSV row: {error}"),
        });
        continue;
      }
    };

    let material_name = record.get(material_index).unwrap_or("").trim();
    let code_value = record.get(code_index).unwrap_or("").trim();
    let dilution = record.get(dilution_index).unwrap_or("").trim();

    if material_name.is_empty() || code_value.is_empty() || dilution.is_empty() {
      errors.push(ImportIssue {
        row: row_number,
        message: "material name, code, and dilution are required".into(),
      });
      continue;
    }

    let code = match code_value.parse::<u32>() {
      Ok(code) => code,
      Err(_) => {
        errors.push(ImportIssue {
          row: row_number,
          message: "code must be numeric".into(),
        });
        continue;
      }
    };

    if let Err(message) = validate_assignable_code(code) {
      errors.push(ImportIssue {
        row: row_number,
        message,
      });
      continue;
    }

    if !seen_codes.insert(code) {
      errors.push(ImportIssue {
        row: row_number,
        message: "duplicate code within import file".into(),
      });
      continue;
    }

    let normalized_name = normalize_material_name(material_name);
    if !existing_materials.contains_key(&normalized_name)
      && !planned_materials.contains_key(&normalized_name)
    {
      planned_materials.insert(
        normalized_name.clone(),
        PlannedMaterial {
          normalized_name: normalized_name.clone(),
          display_name: material_name.to_string(),
        },
      );
    }

    if let Some(existing_bottle) = existing_bottles.get(&code) {
      if existing_bottle.status != "active" {
        errors.push(ImportIssue {
          row: row_number,
          message:
            "code matches an archived bottle; reactivate or create a new active bottle instead"
              .into(),
        });
        continue;
      }

      match import_mode {
        ImportMode::AppendOnly => errors.push(ImportIssue {
          row: row_number,
          message: "code already exists; append-only mode cannot update bottles".into(),
        }),
        ImportMode::UpsertByCode => actions.push(PlannedBottleAction::Update {
          code,
          dilution: dilution.to_string(),
          normalized_name,
          previous_material_id: existing_bottle.material_id.clone(),
        }),
      }
    } else {
      actions.push(PlannedBottleAction::Create {
        code,
        dilution: dilution.to_string(),
        normalized_name,
      });
    }
  }

  Ok(BottlesImportAnalysis {
    mode: import_mode,
    rows_read,
    errors,
    new_materials: planned_materials.into_values().collect(),
    actions,
  })
}

fn resolve_header_index(headers: &StringRecord, candidates: &[&str]) -> Option<usize> {
  headers.iter().position(|header| {
    let normalized_header = header.trim().to_lowercase();
    candidates
      .iter()
      .any(|candidate| normalized_header == candidate.to_lowercase())
  })
}

fn resolve_import_path(file_path: &str) -> Result<PathBuf, String> {
  let trimmed_path = file_path.trim();
  if trimmed_path.is_empty() {
    return Err("import path cannot be empty".into());
  }

  let requested_path = PathBuf::from(trimmed_path);
  if requested_path.is_absolute() {
    if requested_path.is_file() {
      return Ok(requested_path);
    }

    return Err(format!(
      "import file not found at absolute path: {}",
      requested_path.display()
    ));
  }

  if requested_path.is_file() {
    return Ok(requested_path);
  }

  let current_dir =
    env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?;

  for ancestor in current_dir.ancestors() {
    let candidate = ancestor.join(&requested_path);
    if candidate.is_file() {
      return Ok(candidate);
    }
  }

  Err(format!(
    "import file not found: {trimmed_path}. Use an absolute path or a path relative to the project root."
  ))
}

fn resolve_backup_input_path(file_path: &str) -> Result<PathBuf, String> {
  let trimmed_path = file_path.trim();
  if trimmed_path.is_empty() {
    return Err("backup path cannot be empty".into());
  }

  let requested_path = PathBuf::from(trimmed_path);
  if requested_path.is_absolute() {
    if requested_path.is_file() {
      return fs::canonicalize(&requested_path)
        .map_err(|error| format!("failed to resolve backup file path: {error}"));
    }

    return Err(format!(
      "backup file not found at absolute path: {}",
      requested_path.display()
    ));
  }

  if requested_path.is_file() {
    return fs::canonicalize(&requested_path)
      .map_err(|error| format!("failed to resolve backup file path: {error}"));
  }

  let current_dir =
    env::current_dir().map_err(|error| format!("failed to resolve current directory: {error}"))?;

  for ancestor in current_dir.ancestors() {
    let candidate = ancestor.join(&requested_path);
    if candidate.is_file() {
      return fs::canonicalize(&candidate)
        .map_err(|error| format!("failed to resolve backup file path: {error}"));
    }
  }

  Err(format!(
    "backup file not found: {trimmed_path}. Use an absolute path or a path relative to the project root."
  ))
}

fn resolve_backup_output_path(file_path: &str) -> Result<PathBuf, String> {
  let trimmed_path = file_path.trim();
  if trimmed_path.is_empty() {
    return Err("backup destination cannot be empty".into());
  }

  let requested_path = PathBuf::from(trimmed_path);
  let resolved_path = if requested_path.is_absolute() {
    requested_path
  } else {
    let current_dir = env::current_dir()
      .map_err(|error| format!("failed to resolve current directory: {error}"))?;
    current_dir.join(requested_path)
  };

  if resolved_path.exists() {
    if resolved_path.is_dir() {
      return Err(format!(
        "backup destination must be a file path, not a directory: {}",
        resolved_path.display()
      ));
    }

    return Err(format!(
      "backup destination already exists: {}",
      resolved_path.display()
    ));
  }

  let parent = resolved_path.parent().ok_or_else(|| {
    "backup destination must include a parent directory that already exists".to_string()
  })?;

  if !parent.exists() {
    return Err(format!(
      "backup destination folder does not exist: {}",
      parent.display()
    ));
  }

  if !parent.is_dir() {
    return Err(format!(
      "backup destination parent is not a directory: {}",
      parent.display()
    ));
  }

  Ok(resolved_path)
}

fn sibling_backup_path(db_path: &Path, prefix: &str) -> Result<PathBuf, String> {
  let file_name = format!("{prefix}_{}.sqlite3", generate_entity_id("backup")?);
  let parent = db_path
    .parent()
    .ok_or_else(|| "failed to resolve database parent directory".to_string())?;

  Ok(parent.join(file_name))
}

fn inspect_database_file(path: &Path) -> Result<DatabaseBackupMetadata, String> {
  let connection = open_connection(path)?;
  let schema_version = read_user_version(&connection)?;

  if schema_version != SCHEMA_VERSION {
    return Err(format!(
      "database schema version {schema_version} is not supported by this app build"
    ));
  }

  let integrity_check = connection
    .query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0))
    .map_err(|error| format!("failed to run database integrity check: {error}"))?;

  if integrity_check != "ok" {
    return Err(format!("database integrity check failed: {integrity_check}"));
  }

  let mut foreign_key_check = connection
    .prepare("PRAGMA foreign_key_check")
    .map_err(|error| format!("failed to prepare foreign key check: {error}"))?;
  let mut foreign_key_rows = foreign_key_check
    .query([])
    .map_err(|error| format!("failed to run foreign key check: {error}"))?;

  if foreign_key_rows
    .next()
    .map_err(|error| format!("failed to inspect foreign key check rows: {error}"))?
    .is_some()
  {
    return Err("database foreign key check failed".into());
  }

  let mut statement = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map_err(|error| format!("failed to inspect database tables: {error}"))?;

  let table_rows = statement
    .query_map([], |row| row.get::<_, String>(0))
    .map_err(|error| format!("failed to query database tables: {error}"))?;

  let table_names = table_rows
    .collect::<Result<HashSet<_>, _>>()
    .map_err(|error| format!("failed to collect database table names: {error}"))?;

  for required_table in REQUIRED_BACKUP_TABLES {
    if !table_names.contains(required_table) {
      return Err(format!("database is missing required table '{required_table}'"));
    }
  }

  let canonical_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
  let file_size_bytes = fs::metadata(&canonical_path)
    .map_err(|error| format!("failed to read backup file metadata: {error}"))?
    .len();

  Ok(DatabaseBackupMetadata {
    path: canonical_path.display().to_string(),
    file_size_bytes,
    schema_version,
    table_count: table_names.len() as u32,
  })
}

fn log_import<T: Serialize>(
  connection: &Connection,
  import_type: &str,
  mode: &str,
  file_path: &str,
  status: &str,
  summary: &T,
) -> Result<(), String> {
  let summary_json = serde_json::to_string(summary)
    .map_err(|error| format!("failed to serialize import summary: {error}"))?;

  connection
    .execute(
      "
        INSERT INTO imports (
          id,
          type,
          mode,
          source_path,
          status,
          summary_json,
          created_at
        ) VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ",
      params![
        generate_entity_id("import")?,
        import_type,
        mode,
        file_path,
        status,
        summary_json
      ],
    )
    .map_err(|error| format!("failed to log import run: {error}"))?;

  Ok(())
}

fn log_import_failure<T: Serialize>(
  connection: &Connection,
  import_type: &str,
  mode: &str,
  file_path: &str,
  summary: &T,
) -> Result<(), String> {
  log_import(connection, import_type, mode, file_path, "failed", summary)
}
