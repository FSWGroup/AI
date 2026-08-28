-- Audit events and signature events are append-only records.
-- Application code never updates them; this trigger makes that a hard
-- database guarantee rather than a convention.

CREATE OR REPLACE FUNCTION fsw_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only and cannot be % ', TG_TABLE_NAME, lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION fsw_prevent_mutation();

CREATE TRIGGER document_signature_append_only
  BEFORE UPDATE OR DELETE ON "DocumentSignature"
  FOR EACH ROW EXECUTE FUNCTION fsw_prevent_mutation();

-- Guard against circular manager hierarchies (§53): walking up the
-- current-employment manager chain from the new manager must never reach
-- the worker being updated.
CREATE OR REPLACE FUNCTION fsw_check_manager_cycle() RETURNS trigger AS $$
DECLARE
  cur TEXT;
  depth INT := 0;
BEGIN
  IF NEW."managerId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."managerId" = NEW."workerId" THEN
    RAISE EXCEPTION 'A worker cannot be their own manager';
  END IF;
  cur := NEW."managerId";
  WHILE cur IS NOT NULL AND depth < 100 LOOP
    SELECT e."managerId" INTO cur
    FROM "EmploymentRecord" e
    WHERE e."workerId" = cur AND e."effectiveTo" IS NULL
    ORDER BY e."effectiveFrom" DESC
    LIMIT 1;
    IF cur = NEW."workerId" THEN
      RAISE EXCEPTION 'Manager assignment would create a circular reporting structure';
    END IF;
    depth := depth + 1;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employment_manager_cycle_check
  BEFORE INSERT OR UPDATE ON "EmploymentRecord"
  FOR EACH ROW EXECUTE FUNCTION fsw_check_manager_cycle();
