CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_materials_status ON materials(status);

CREATE TABLE IF NOT EXISTS bottles (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  code INTEGER NOT NULL,
  dilution TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY(material_id) REFERENCES materials(id),
  UNIQUE(code),
  CHECK(code >= 100 AND code <= 999)
);

CREATE INDEX IF NOT EXISTS idx_bottles_material_id ON bottles(material_id);
CREATE INDEX IF NOT EXISTS idx_bottles_status ON bottles(status);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  target_batch_size INTEGER NOT NULL CHECK (target_batch_size > 0),
  session_note TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ended_at ON sessions(ended_at);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  bottle_id TEXT NOT NULL,
  code_entered INTEGER NOT NULL,
  material_id_at_reveal TEXT NOT NULL,
  guessed_material_id TEXT NOT NULL,
  pre_reveal_note TEXT,
  post_reveal_note TEXT,
  revealed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(bottle_id) REFERENCES bottles(id),
  FOREIGN KEY(material_id_at_reveal) REFERENCES materials(id),
  FOREIGN KEY(guessed_material_id) REFERENCES materials(id),
  CHECK(code_entered >= 100 AND code_entered <= 999)
);

CREATE INDEX IF NOT EXISTS idx_attempts_session_id ON attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_attempts_bottle_id ON attempts(bottle_id);
CREATE INDEX IF NOT EXISTS idx_attempts_material_id_at_reveal ON attempts(material_id_at_reveal);
CREATE INDEX IF NOT EXISTS idx_attempts_guessed_material_id ON attempts(guessed_material_id);
CREATE INDEX IF NOT EXISTS idx_attempts_revealed_at ON attempts(revealed_at);

CREATE TABLE IF NOT EXISTS bottle_assignment_audit (
  id TEXT PRIMARY KEY,
  bottle_id TEXT NOT NULL,
  old_material_id TEXT NOT NULL,
  new_material_id TEXT NOT NULL,
  reason TEXT,
  changed_at TEXT NOT NULL,
  FOREIGN KEY(bottle_id) REFERENCES bottles(id),
  FOREIGN KEY(old_material_id) REFERENCES materials(id),
  FOREIGN KEY(new_material_id) REFERENCES materials(id)
);

CREATE INDEX IF NOT EXISTS idx_bottle_assignment_audit_bottle_id
  ON bottle_assignment_audit(bottle_id);
CREATE INDEX IF NOT EXISTS idx_bottle_assignment_audit_changed_at
  ON bottle_assignment_audit(changed_at);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('materials_csv', 'bottles_csv')),
  mode TEXT NOT NULL,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('previewed', 'committed', 'failed')),
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_imports_type ON imports(type);
CREATE INDEX IF NOT EXISTS idx_imports_created_at ON imports(created_at);
