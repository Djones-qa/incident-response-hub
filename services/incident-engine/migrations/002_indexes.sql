-- 002_indexes.sql
-- Performance indexes for Incident Response Platform

-- ============================================================
-- Incidents indexes
-- ============================================================

-- Index for filtering by status (commonly used in list queries)
CREATE INDEX idx_incidents_status ON incidents(status);

-- Index for filtering by severity (commonly used in list queries)
CREATE INDEX idx_incidents_severity ON incidents(severity);

-- Index for ordering and date range filtering by declared_at
CREATE INDEX idx_incidents_declared_at ON incidents(declared_at DESC);

-- Composite index for common filter combinations
CREATE INDEX idx_incidents_status_severity ON incidents(status, severity);

-- Index for resolved_at (used in MTTR calculations)
CREATE INDEX idx_incidents_resolved_at ON incidents(resolved_at) WHERE resolved_at IS NOT NULL;

-- ============================================================
-- Timeline entries indexes
-- ============================================================

-- Index for looking up entries by incident_id (foreign key)
CREATE INDEX idx_timeline_entries_incident_id ON timeline_entries(incident_id);

-- Index for ordering timeline entries by creation time within an incident
CREATE INDEX idx_timeline_entries_incident_created ON timeline_entries(incident_id, created_at ASC);

-- Index for filtering by type (used for resolution entry check)
CREATE INDEX idx_timeline_entries_type ON timeline_entries(type);

-- ============================================================
-- Post-mortems indexes
-- ============================================================

-- Unique index on incident_id is already enforced by UNIQUE constraint
-- Index for filtering by status
CREATE INDEX idx_post_mortems_status ON post_mortems(status);

-- ============================================================
-- Runbook executions indexes
-- ============================================================

-- Index for looking up executions by incident_id (foreign key)
CREATE INDEX idx_runbook_executions_incident_id ON runbook_executions(incident_id);

-- Index for looking up executions by runbook_id (foreign key)
CREATE INDEX idx_runbook_executions_runbook_id ON runbook_executions(runbook_id);

-- Index for filtering by execution status
CREATE INDEX idx_runbook_executions_status ON runbook_executions(status);

-- Index for watchdog timer queries (finding stale executions)
CREATE INDEX idx_runbook_executions_progress ON runbook_executions(last_progress_at)
    WHERE status = 'running';

-- ============================================================
-- Runbooks indexes
-- ============================================================

-- Index for ordering runbooks by creation time
CREATE INDEX idx_runbooks_created_at ON runbooks(created_at DESC);
