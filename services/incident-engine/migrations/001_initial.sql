-- 001_initial.sql
-- Initial schema for Incident Response Platform

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Severity enum type
CREATE TYPE incident_severity AS ENUM ('critical', 'high', 'medium', 'low');

-- Incident status enum type
CREATE TYPE incident_status AS ENUM ('declared', 'investigating', 'mitigating', 'resolved', 'closed');

-- Timeline entry type enum
CREATE TYPE timeline_entry_type AS ENUM ('detection', 'action', 'communication', 'escalation', 'resolution', 'note');

-- Post-mortem status enum
CREATE TYPE post_mortem_status AS ENUM ('draft', 'review', 'published');

-- Runbook execution status enum
CREATE TYPE execution_status AS ENUM ('pending', 'running', 'completed', 'failed', 'rolled_back');

-- ============================================================
-- Incidents table
-- ============================================================
CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description VARCHAR(5000) NOT NULL,
    severity incident_severity NOT NULL,
    status incident_status NOT NULL DEFAULT 'declared',
    affected_services TEXT[] NOT NULL DEFAULT '{}',
    assigned_responders UUID[] NOT NULL DEFAULT '{}',
    declared_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_title_not_empty CHECK (LENGTH(TRIM(title)) > 0),
    CONSTRAINT chk_description_not_empty CHECK (LENGTH(TRIM(description)) > 0),
    CONSTRAINT chk_affected_services_not_empty CHECK (array_length(affected_services, 1) > 0),
    CONSTRAINT chk_resolved_at_status CHECK (
        (status IN ('resolved', 'closed') AND resolved_at IS NOT NULL)
        OR (status NOT IN ('resolved', 'closed') AND resolved_at IS NULL)
    ),
    CONSTRAINT chk_closed_at_status CHECK (
        (status = 'closed' AND closed_at IS NOT NULL)
        OR (status != 'closed' AND closed_at IS NULL)
    )
);

-- ============================================================
-- Timeline entries table
-- ============================================================
CREATE TABLE timeline_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id UUID NOT NULL,
    type timeline_entry_type NOT NULL,
    author VARCHAR(200) NOT NULL,
    content VARCHAR(5000) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Foreign key with cascade delete
    CONSTRAINT fk_timeline_incident
        FOREIGN KEY (incident_id)
        REFERENCES incidents(id)
        ON DELETE CASCADE,

    -- Constraints
    CONSTRAINT chk_author_not_empty CHECK (LENGTH(TRIM(author)) > 0),
    CONSTRAINT chk_content_not_empty CHECK (LENGTH(TRIM(content)) > 0)
);

-- ============================================================
-- Post-mortems table
-- ============================================================
CREATE TABLE post_mortems (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id UUID NOT NULL UNIQUE,
    status post_mortem_status NOT NULL DEFAULT 'draft',
    summary TEXT NOT NULL DEFAULT '',
    root_cause TEXT NOT NULL DEFAULT '',
    impact_assessment JSONB NOT NULL DEFAULT '{}',
    action_items JSONB NOT NULL DEFAULT '[]',
    lessons TEXT NOT NULL DEFAULT '',
    impact_duration_minutes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Foreign key with cascade delete
    CONSTRAINT fk_postmortem_incident
        FOREIGN KEY (incident_id)
        REFERENCES incidents(id)
        ON DELETE CASCADE,

    -- Constraints
    CONSTRAINT chk_impact_duration_non_negative CHECK (impact_duration_minutes >= 0)
);

-- ============================================================
-- Runbooks table
-- ============================================================
CREATE TABLE runbooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trigger_conditions JSONB NOT NULL DEFAULT '[]',
    steps JSONB NOT NULL DEFAULT '[]',
    rollback_steps JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_runbook_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- ============================================================
-- Runbook executions table
-- ============================================================
CREATE TABLE runbook_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id UUID NOT NULL,
    runbook_id UUID NOT NULL,
    status execution_status NOT NULL DEFAULT 'pending',
    step_results JSONB NOT NULL DEFAULT '[]',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    last_progress_at TIMESTAMP WITH TIME ZONE,

    -- Foreign keys
    CONSTRAINT fk_execution_incident
        FOREIGN KEY (incident_id)
        REFERENCES incidents(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_execution_runbook
        FOREIGN KEY (runbook_id)
        REFERENCES runbooks(id)
        ON DELETE CASCADE
);
