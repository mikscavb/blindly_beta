CREATE TABLE IF NOT EXISTS session_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  bottle_id TEXT,
  code_entered INTEGER,
  dilution TEXT,
  true_material_id TEXT,
  guessed_material_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('match', 'mismatch', 'skipped')),
  pre_reveal_note TEXT,
  revealed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(bottle_id) REFERENCES bottles(id),
  FOREIGN KEY(true_material_id) REFERENCES materials(id),
  FOREIGN KEY(guessed_material_id) REFERENCES materials(id),
  CHECK(code_entered IS NULL OR (code_entered >= 100 AND code_entered <= 999)),
  UNIQUE(session_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_session_entries_session_id
  ON session_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_session_entries_status
  ON session_entries(status);
CREATE INDEX IF NOT EXISTS idx_session_entries_revealed_at
  ON session_entries(revealed_at);
