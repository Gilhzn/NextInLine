-- "Has this household already scanned a card statement?" is read on every money overview.
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, action);
