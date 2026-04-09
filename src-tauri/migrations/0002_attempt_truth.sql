ALTER TABLE attempts ADD COLUMN material_id_at_reveal TEXT;

UPDATE attempts
SET material_id_at_reveal = (
  SELECT bottles.material_id
  FROM bottles
  WHERE bottles.id = attempts.bottle_id
)
WHERE material_id_at_reveal IS NULL;

CREATE INDEX IF NOT EXISTS idx_attempts_material_id_at_reveal
  ON attempts(material_id_at_reveal);
