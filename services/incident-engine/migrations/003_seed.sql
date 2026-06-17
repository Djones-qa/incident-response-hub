-- 003_seed.sql
-- Development seed data for Incident Response Platform

-- ============================================================
-- Seed incidents
-- ============================================================

INSERT INTO incidents (id, title, description, severity, status, affected_services, assigned_responders, declared_at, created_at, resolved_at, closed_at, updated_at)
VALUES
    (
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'Database connection pool exhausted',
        'Production database connection pool reached maximum capacity causing request timeouts across user-facing services. Impact started at 14:30 UTC with error rates exceeding 50%.',
        'critical',
        'resolved',
        ARRAY['api-gateway', 'user-service', 'payment-service'],
        ARRAY['11111111-1111-1111-1111-111111111111'::UUID, '22222222-2222-2222-2222-222222222222'::UUID],
        '2024-01-15 14:30:00+00',
        '2024-01-15 14:30:00+00',
        '2024-01-15 16:45:00+00',
        NULL,
        '2024-01-15 16:45:00+00'
    ),
    (
        'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        'Redis cache cluster node failure',
        'One of three Redis cluster nodes went offline causing cache misses and increased latency. Failover did not trigger automatically due to misconfigured sentinel.',
        'high',
        'closed',
        ARRAY['cache-layer', 'session-service'],
        ARRAY['22222222-2222-2222-2222-222222222222'::UUID, '33333333-3333-3333-3333-333333333333'::UUID],
        '2024-01-10 09:15:00+00',
        '2024-01-10 09:15:00+00',
        '2024-01-10 11:30:00+00',
        '2024-01-10 14:00:00+00',
        '2024-01-10 14:00:00+00'
    ),
    (
        'c3d4e5f6-a7b8-9012-cdef-123456789012',
        'Elevated error rates on checkout flow',
        'Customers reporting intermittent failures during checkout. Payment provider returning 502 errors on approximately 15% of requests.',
        'medium',
        'investigating',
        ARRAY['payment-service', 'checkout-ui'],
        ARRAY['11111111-1111-1111-1111-111111111111'::UUID],
        '2024-01-20 10:00:00+00',
        '2024-01-20 10:00:00+00',
        NULL,
        NULL,
        '2024-01-20 10:15:00+00'
    ),
    (
        'd4e5f6a7-b8c9-0123-defa-234567890123',
        'SSL certificate expiration warning',
        'Monitoring detected that the wildcard certificate for *.example.com expires in 48 hours. Auto-renewal failed due to DNS challenge timeout.',
        'low',
        'declared',
        ARRAY['infrastructure'],
        ARRAY[]::UUID[],
        '2024-01-21 08:00:00+00',
        '2024-01-21 08:00:00+00',
        NULL,
        NULL,
        '2024-01-21 08:00:00+00'
    );

-- ============================================================
-- Seed timeline entries
-- ============================================================

INSERT INTO timeline_entries (id, incident_id, type, author, content, metadata, created_at)
VALUES
    -- Database connection pool incident timeline
    (
        'e5f6a7b8-c9d0-1234-efab-345678901234',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'detection',
        'monitoring-system',
        'Incident declared: Database connection pool exhausted (critical) affecting api-gateway, user-service, payment-service',
        '{"source": "datadog", "alert_id": "alert-12345"}',
        '2024-01-15 14:30:00+00'
    ),
    (
        'f6a7b8c9-d0e1-2345-fabc-456789012345',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'action',
        'alice@example.com',
        'Status changed from declared to investigating',
        NULL,
        '2024-01-15 14:35:00+00'
    ),
    (
        'a7b8c9d0-e1f2-3456-abcd-567890123456',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'communication',
        'alice@example.com',
        'Notified engineering channel: investigating database connection pool exhaustion. ETA for resolution: 1 hour.',
        '{"channel": "slack", "room": "#engineering-incidents"}',
        '2024-01-15 14:40:00+00'
    ),
    (
        'b8c9d0e1-f2a3-4567-bcde-678901234567',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'action',
        'bob@example.com',
        'Status changed from investigating to mitigating. Increased connection pool size from 20 to 50 and restarted affected pods.',
        NULL,
        '2024-01-15 15:30:00+00'
    ),
    (
        'c9d0e1f2-a3b4-5678-cdef-789012345678',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'resolution',
        'bob@example.com',
        'Root cause identified: connection leak in user-service v2.3.1. Deployed hotfix v2.3.2 with proper connection cleanup. Connection pool utilization back to normal levels.',
        '{"fix_version": "v2.3.2", "deploy_id": "deploy-98765"}',
        '2024-01-15 16:40:00+00'
    ),
    (
        'd0e1f2a3-b4c5-6789-defa-890123456789',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'action',
        'bob@example.com',
        'Status changed from mitigating to resolved',
        NULL,
        '2024-01-15 16:45:00+00'
    ),
    -- Redis cache incident timeline
    (
        'e1f2a3b4-c5d6-7890-efab-901234567890',
        'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        'detection',
        'monitoring-system',
        'Incident declared: Redis cache cluster node failure (high) affecting cache-layer, session-service',
        '{"source": "prometheus", "alert_id": "alert-67890"}',
        '2024-01-10 09:15:00+00'
    ),
    (
        'f2a3b4c5-d6e7-8901-fabc-012345678901',
        'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        'escalation',
        'system',
        'Severity escalated from high to critical due to session service impact',
        '{"previous_severity": "high", "new_severity": "critical"}',
        '2024-01-10 09:45:00+00'
    ),
    -- Checkout flow incident timeline
    (
        'a3b4c5d6-e7f8-9012-abcd-123456789012',
        'c3d4e5f6-a7b8-9012-cdef-123456789012',
        'detection',
        'monitoring-system',
        'Incident declared: Elevated error rates on checkout flow (medium) affecting payment-service, checkout-ui',
        NULL,
        '2024-01-20 10:00:00+00'
    ),
    (
        'b4c5d6e7-f8a9-0123-bcde-234567890123',
        'c3d4e5f6-a7b8-9012-cdef-123456789012',
        'action',
        'alice@example.com',
        'Status changed from declared to investigating. Checking payment provider status page.',
        NULL,
        '2024-01-20 10:15:00+00'
    );

-- ============================================================
-- Seed post-mortem (for the resolved database incident)
-- ============================================================

INSERT INTO post_mortems (id, incident_id, status, summary, root_cause, impact_assessment, action_items, lessons, impact_duration_minutes, created_at, updated_at)
VALUES
    (
        '12345678-abcd-ef01-2345-678901234567',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'draft',
        'Database connection pool exhaustion caused 2+ hours of degraded service for user-facing applications.',
        'A connection leak in user-service v2.3.1 caused connections to not be returned to the pool after timeout errors. Under load, the pool was exhausted within 30 minutes.',
        '{"affectedServices": ["api-gateway", "user-service", "payment-service"], "durationMinutes": 135, "usersAffected": "approximately 50,000"}',
        '[{"id": "ai-001", "description": "Add connection pool monitoring alerts at 70% utilization", "assignee": "bob@example.com", "priority": "high", "dueDate": "2024-02-01", "status": "open"}, {"id": "ai-002", "description": "Implement connection leak detection in CI pipeline", "assignee": "alice@example.com", "priority": "medium", "dueDate": "2024-02-15", "status": "open"}]',
        'Connection pool exhaustion can cascade quickly. Need proactive monitoring before saturation. The hotfix deployment process worked well once root cause was identified.',
        135,
        '2024-01-15 17:00:00+00',
        '2024-01-15 17:00:00+00'
    );

-- ============================================================
-- Seed runbooks
-- ============================================================

INSERT INTO runbooks (id, name, description, trigger_conditions, steps, rollback_steps, created_at, updated_at)
VALUES
    (
        '98765432-abcd-ef01-2345-678901234567',
        'Database Connection Pool Recovery',
        'Automated recovery procedure for database connection pool exhaustion. Increases pool size and restarts affected services.',
        '[{"field": "severity", "operator": "equals", "value": "critical"}, {"field": "affected_services", "operator": "contains", "value": "api-gateway"}]',
        '[{"order": 1, "name": "Increase pool size", "type": "automated", "command": "kubectl set env deployment/db-pool POOL_SIZE=100", "expectedOutcome": "Pool size increased to 100", "timeout": 30, "retries": 2}, {"order": 2, "name": "Restart affected pods", "type": "automated", "command": "kubectl rollout restart deployment/api-gateway", "expectedOutcome": "Pods restarted with new pool config", "timeout": 120, "retries": 1}, {"order": 3, "name": "Verify connections", "type": "manual", "expectedOutcome": "Connection pool utilization below 50%", "timeout": 300, "retries": 0}]',
        '[{"order": 1, "name": "Revert pool size", "type": "automated", "command": "kubectl set env deployment/db-pool POOL_SIZE=20", "expectedOutcome": "Pool size reverted to 20", "timeout": 30, "retries": 1}]',
        '2024-01-01 12:00:00+00',
        '2024-01-01 12:00:00+00'
    ),
    (
        '87654321-abcd-ef01-2345-678901234567',
        'Redis Failover Procedure',
        'Manual and automated steps to handle Redis node failures including sentinel reconfiguration.',
        '[{"field": "affected_services", "operator": "contains", "value": "cache-layer"}]',
        '[{"order": 1, "name": "Check sentinel status", "type": "automated", "command": "redis-cli -p 26379 sentinel masters", "expectedOutcome": "Sentinel responds with master list", "timeout": 10, "retries": 3}, {"order": 2, "name": "Trigger manual failover", "type": "automated", "command": "redis-cli -p 26379 sentinel failover mymaster", "expectedOutcome": "Failover initiated", "timeout": 30, "retries": 1}, {"order": 3, "name": "Verify new master", "type": "manual", "expectedOutcome": "New master elected and accepting writes", "timeout": 60, "retries": 0}]',
        '[{"order": 1, "name": "Revert to original master", "type": "automated", "command": "redis-cli -p 26379 sentinel reset mymaster", "expectedOutcome": "Sentinel reset", "timeout": 30, "retries": 2}]',
        '2024-01-05 10:00:00+00',
        '2024-01-05 10:00:00+00'
    );

-- ============================================================
-- Seed runbook execution (for the database incident)
-- ============================================================

INSERT INTO runbook_executions (id, incident_id, runbook_id, status, step_results, started_at, completed_at, error, last_progress_at)
VALUES
    (
        '11223344-aabb-ccdd-eeff-112233445566',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '98765432-abcd-ef01-2345-678901234567',
        'completed',
        '[{"stepOrder": 1, "status": "success", "output": "deployment.apps/db-pool env updated", "durationMs": 2500, "retryCount": 0}, {"stepOrder": 2, "status": "success", "output": "deployment.apps/api-gateway restarted", "durationMs": 45000, "retryCount": 0}, {"stepOrder": 3, "status": "skipped", "output": "", "durationMs": 0, "retryCount": 0}]',
        '2024-01-15 15:00:00+00',
        '2024-01-15 15:02:00+00',
        NULL,
        '2024-01-15 15:02:00+00'
    );
