-- Append-only enforcement (CLAUDE.md rule 2): no UPDATE/DELETE/TRUNCATE on audit and patrol logs.
CREATE OR REPLACE FUNCTION gatehouse_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER immutable_audit_logs_no_mutation
  BEFORE UPDATE OR DELETE ON immutable_audit_logs
  FOR EACH ROW EXECUTE FUNCTION gatehouse_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER immutable_audit_logs_no_truncate
  BEFORE TRUNCATE ON immutable_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION gatehouse_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER patrol_logs_no_mutation
  BEFORE UPDATE OR DELETE ON patrol_logs
  FOR EACH ROW EXECUTE FUNCTION gatehouse_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER patrol_logs_no_truncate
  BEFORE TRUNCATE ON patrol_logs
  FOR EACH STATEMENT EXECUTE FUNCTION gatehouse_forbid_mutation();
--> statement-breakpoint
-- Spatial indexes
CREATE INDEX sites_geofence_gix ON sites USING GIST (geofence);
--> statement-breakpoint
CREATE INDEX checkpoints_location_gix ON checkpoints USING GIST (location);
