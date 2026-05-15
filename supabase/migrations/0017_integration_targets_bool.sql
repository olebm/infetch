-- Convert integration_targets.enabled from INTEGER to BOOLEAN.
-- The existing WHERE enabled = 1 query worked as INTEGER but is semantically wrong
-- after the rest of the schema moves to BOOLEAN.
ALTER TABLE integration_targets ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE integration_targets ALTER COLUMN enabled TYPE BOOLEAN USING (enabled != 0);
ALTER TABLE integration_targets ALTER COLUMN enabled SET DEFAULT false;
