# Implementation Plan: Incident Response Platform

## Overview

This plan implements a TypeScript/Node.js monorepo with four services (incident-engine, notification-service, analytics-service, runbook-worker) using Express.js, PostgreSQL, Redis, Docker, and Kubernetes. Tasks are structured to build shared infrastructure first, then each service incrementally, wiring cross-service communication last.

## Tasks

- [x] 1. Set up monorepo structure, shared packages, and infrastructure
  - [x] 1.1 Initialize monorepo with workspace configuration
    - Create root `package.json` with npm workspaces pointing to `services/*` and `packages/*`
    - Create root `tsconfig.json` with TypeScript 5.3, strict mode, ES2022 target, composite project references
    - Create `packages/shared-types/` with all shared TypeScript interfaces (Incident, TimelineEntry, PostMortem, Runbook, RunbookExecution, EscalationPolicy, Notification, ErrorResponse, IncidentEvent, NotificationRequest)
    - Create `packages/shared-utils/` with common utilities (validation helpers, date formatting, error factory)
    - Add `.gitignore`, `.eslintrc.json`, `.prettierrc`
    - _Requirements: 20.2, 20.3_

  - [x] 1.2 Set up Docker and database infrastructure
    - Create `docker-compose.yml` with PostgreSQL 15 and Redis 7 services
    - Create `services/incident-engine/migrations/001_initial.sql` with full PostgreSQL schema (incidents, timeline_entries, post_mortems, runbooks, runbook_executions tables with all constraints, indexes, cascade rules)
    - Create `services/incident-engine/migrations/002_indexes.sql` with performance indexes (status, severity, declared_at, incident_id FKs)
    - Create seed script for development data
    - _Requirements: 20.1, 20.4_

  - [x] 1.3 Set up service scaffolding for all four services
    - Create `services/incident-engine/` with `package.json`, `tsconfig.json`, `src/index.ts` (Express app with health/ready endpoints)
    - Create `services/notification-service/` with `package.json`, `tsconfig.json`, `src/index.ts` (Express app with health/ready endpoints)
    - Create `services/analytics-service/` with `package.json`, `tsconfig.json`, `src/index.ts` (Express app with health/ready endpoints)
    - Create `services/runbook-worker/` with `package.json`, `tsconfig.json`, `src/index.ts` (Redis Stream consumer entry point)
    - Each service gets `src/config.ts` for environment variables, `src/db.ts` or `src/redis.ts` for connection setup
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [x] 1.4 Set up testing infrastructure
    - Add Jest configuration at root and per-service with `ts-jest`
    - Add `fast-check` dependency for property-based tests
    - Create test helper utilities: database test setup/teardown, Redis mock, request factory
    - Configure npm scripts: `test:unit`, `test:property`, `test:integration`, `test`
    - Create `packages/test-helpers/` with shared generators (`arbitraryIncident`, `arbitrarySeverity`, `arbitraryStatus`, `arbitraryTimelineEntry`, `arbitraryRunbook`, `arbitraryTriggerCondition`, `arbitraryEscalationPolicy`, `arbitraryStatusTransitionSequence`)
    - _Requirements: All_

- [x] 2. Checkpoint - Ensure infrastructure builds
  - Ensure all packages compile with `tsc --build`, Docker containers start, and migrations run. Ask the user if questions arise.

- [x] 3. Implement incident-engine core: incidents and state machine
  - [x] 3.1 Implement incident declaration endpoint
    - Create `services/incident-engine/src/routes/incidents.ts` with POST /incidents handler
    - Implement validation: title (non-empty, max 200 chars, no whitespace-only), description (non-empty, max 5000 chars, no whitespace-only), severity (valid enum), affectedServices (at least one)
    - Create incident record in PostgreSQL with status "declared", generate UUID, set declaredAt = createdAt
    - Auto-create timeline entry of type "detection" with incident title, severity, and affected services
    - Return 201 with created incident; return 400 with field-specific errors on validation failure
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 3.2 Write property tests for incident creation (Properties 1, 2)
    - **Property 1: Incident creation invariants** — For any valid declaration, verify status is "declared", declaredAt equals createdAt, and a "detection" timeline entry exists
    - **Property 2: Invalid declaration rejection** — For any invalid declaration (missing fields, whitespace-only, invalid severity), verify 400 error and no record created
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**

  - [x] 3.3 Implement incident status transition endpoint
    - Create PATCH /incidents/:id/status handler
    - Implement state machine: only allow declared→investigating, investigating→mitigating, mitigating→resolved, resolved→closed
    - Use PostgreSQL advisory lock (`pg_advisory_xact_lock`) for concurrent transition serialization
    - Validate mitigating→resolved requires at least one "resolution" timeline entry
    - Set resolvedAt on transition to resolved, closedAt on transition to closed
    - Auto-create "action" timeline entry recording previous and new status
    - Return 200 on success; 400 on invalid transition; 404 if incident not found
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 17.1, 17.2, 17.3, 17.5_

  - [ ]* 3.4 Write property tests for state machine (Properties 5, 6, 7, 32)
    - **Property 5: State machine transition validity** — For any (current, target) pair, verify success iff pair is in valid set
    - **Property 6: Timestamp invariants** — After any transition sequence, verify resolvedAt/closedAt null/non-null invariants
    - **Property 7: Status transitions produce timeline entries** — For any successful transition, verify "action" timeline entry exists
    - **Property 32: Concurrent transition serialization** — For concurrent requests, verify at most one succeeds per conflicting pair
    - **Validates: Requirements 3.1-3.8, 17.1-17.3, 17.5**

  - [x] 3.5 Implement severity escalation endpoint
    - Create PATCH /incidents/:id/severity handler
    - Enforce severity ordering: low < medium < high < critical
    - Allow escalation only during active statuses (declared, investigating, mitigating)
    - Reject downgrades, same-level changes, changes on resolved/closed, and escalation when already critical
    - Auto-create "escalation" timeline entry recording previous and new severity
    - Return 200 on success; 400 on invalid change; 404 if incident not found
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 17.4_

  - [ ]* 3.6 Write property tests for severity escalation (Property 8, 9)
    - **Property 8: Severity monotonicity during active incidents** — For any incident and severity change, verify escalation succeeds iff new > current and status is active
    - **Property 9: Severity escalation produces timeline entry** — For any successful escalation, verify "escalation" timeline entry exists
    - **Validates: Requirements 4.1-4.6, 17.4**

- [x] 4. Implement incident-engine: retrieval, timeline, responders
  - [x] 4.1 Implement incident retrieval and filtering
    - Create GET /incidents handler with query params: status, severity, startDate, endDate, page, pageSize
    - Order by declaredAt descending, default page size 20, max 100
    - Implement filter predicates: status match, severity match, date range inclusive
    - Create GET /incidents/:id handler returning full incident with timeline
    - Return 400 for invalid filter values; 404 for non-existent incident
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 4.2 Write property tests for filtering and pagination (Properties 3, 4)
    - **Property 3: Filter correctness** — For any set of incidents and filter combination, all returned incidents satisfy every filter predicate
    - **Property 4: List ordering and pagination** — Verify descending declaredAt order, page size bounds, total count correctness
    - **Validates: Requirements 2.1-2.4**

  - [x] 4.3 Implement timeline management endpoints
    - Create POST /incidents/:id/timeline handler with validation: type (valid enum), author (non-empty, max 200), content (non-empty, max 5000), metadata (optional, max 20 keys, key max 100 chars, value max 500 chars)
    - Create GET /incidents/:id/timeline handler returning entries ordered by timestamp ascending
    - Return 400 for invalid type, missing fields; 404 if incident not found
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 4.4 Write property tests for timeline (Properties 10, 11)
    - **Property 10: Timeline ordering invariant** — For any incident with multiple entries, verify ascending timestamp order
    - **Property 11: Timeline metadata round-trip** — For any valid metadata, verify stored and retrieved values are identical
    - **Validates: Requirements 5.3, 5.4**

  - [x] 4.5 Implement responder assignment endpoint
    - Create POST /incidents/:id/responders handler
    - Accept array of responder IDs (max 20 per request), deduplicate against existing assignments
    - Reject assignment on resolved/closed incidents
    - Auto-create "action" timeline entry recording assignment
    - Return 200 on success; 400 on invalid status; 404 if incident not found
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 4.6 Write property test for responder assignment (Property 12)
    - **Property 12: Responder assignment idempotence** — For any incident and responder, assigning multiple times results in exactly one occurrence
    - **Validates: Requirements 6.1, 6.3**

- [x] 5. Checkpoint - Ensure incident-engine core tests pass
  - Ensure all unit and property tests pass for incident-engine core functionality. Ask the user if questions arise.

- [ ] 6. Implement incident-engine: post-mortems, runbooks, and trigger matching
  - [x] 6.1 Implement post-mortem generation endpoint
    - Create POST /incidents/:id/postmortem handler
    - Validate incident is resolved or closed; return 400 if not
    - Check for existing post-mortem; return 409 if exists
    - Generate post-mortem with status "draft", calculate impact_duration_minutes (resolvedAt - declaredAt), copy affected services, include all timeline entries
    - Create GET /incidents/:id/postmortem handler returning full document
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 6.2 Write property test for post-mortem generation (Property 13)
    - **Property 13: Post-mortem generation correctness** — For any resolved/closed incident, verify draft status, correct impact duration, matching affected services, complete timeline
    - **Validates: Requirements 7.1-7.4**

  - [x] 6.3 Implement runbook CRUD endpoints
    - Create POST /runbooks handler with validation: name, description, trigger conditions, steps (unique order, name, type, expectedOutcome, timeout > 0, retries 0-10, command required for automated), rollback steps
    - Create GET /runbooks (ordered by creation time desc) and GET /runbooks/:id
    - Return 400 for validation errors (duplicate step orders, missing fields, invalid types)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 6.4 Write property tests for runbook validation (Properties 14, 15)
    - **Property 14: Runbook step order uniqueness** — For any request with duplicate step orders, verify 400 rejection
    - **Property 15: Runbook validation** — For any step missing required fields or automated step missing command, verify 400 rejection
    - **Validates: Requirements 8.2, 8.3, 8.6**

  - [x] 6.5 Implement trigger condition matching and runbook suggestion
    - Create GET /incidents/:id/suggested-runbooks handler
    - Implement trigger condition evaluation: equals (case-sensitive), contains (case-insensitive substring), gt (numeric >), lt (numeric <)
    - Non-numeric values with gt/lt operators → non-matching
    - Return runbooks where ALL conditions match, ordered by creation time ascending (oldest first)
    - Return empty list if no matches
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9_

  - [ ]* 6.6 Write property tests for trigger condition matching (Properties 29, 30)
    - **Property 29: Trigger condition operator semantics** — For any field value and condition, verify operator matching behavior (equals, contains, gt, lt)
    - **Property 30: Trigger condition conjunction and runbook suggestion** — For any incident and runbooks, verify a runbook appears iff ALL conditions match, ordered by creation time
    - **Validates: Requirements 19.2-19.9**

  - [x] 6.7 Implement runbook execution trigger endpoint
    - Create POST /runbooks/:id/execute handler
    - Validate incident and runbook exist; return 400 if not
    - Create runbook_execution record with status "pending"
    - Publish execution event to Redis Stream `runbook-executions`
    - Return execution ID
    - _Requirements: 9.1, 9.9_

- [x] 7. Implement runbook-worker service
  - [x] 7.1 Implement Redis Stream consumer and step executor
    - Create `services/runbook-worker/src/consumer.ts` consuming from `runbook-executions` stream
    - Set execution status to "running" and record startedAt before first step
    - Execute automated steps sequentially by order field, skip manual steps
    - Enforce step timeout; treat timeout as step failure
    - Record step results: status, output (truncated to 10,000 chars), durationMs, retryCount
    - Publish progress events to `execution-progress` stream after each step
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.7, 18.1, 18.6_

  - [x] 7.2 Implement retry with exponential backoff and rollback
    - On step failure, retry with exponential backoff: delay = min(2^(attempt-1), 8) seconds, up to configured max retries (3)
    - After all retries exhausted, execute rollback steps in reverse order
    - Continue executing rollback steps even if one fails
    - Set final status: "completed" if all succeed, "rolled_back" if failure + successful rollback, "failed" if failure + rollback failure
    - _Requirements: 9.4, 9.5, 9.8, 18.2, 18.3, 18.4, 18.5_

  - [x] 7.3 Implement execution watchdog timer
    - Monitor execution progress; if no update within 30 seconds of last step completion, set status to "failed" with error indicating interrupted execution
    - _Requirements: 18.7_

  - [ ]* 7.4 Write property tests for runbook execution (Properties 16, 17, 18, 19, 20)
    - **Property 16: Execution step sequencing** — Verify automated steps execute in ascending order, manual steps skipped
    - **Property 17: Exponential backoff** — For failing steps with retries, verify delays of 1s, 2s, 4s (capped at 8s)
    - **Property 18: Rollback execution on failure** — Verify rollback in reverse order, continues on rollback failure
    - **Property 19: Execution final status determination** — Verify completed/rolled_back/failed status based on outcomes
    - **Property 20: Step result completeness** — Verify step results array length and field presence
    - **Validates: Requirements 9.2-9.6, 18.1-18.5**

- [x] 8. Checkpoint - Ensure incident-engine and runbook-worker tests pass
  - Ensure all tests pass for incident-engine and runbook-worker. Ask the user if questions arise.

- [ ] 9. Implement notification-service
  - [x] 9.1 Implement notification delivery endpoint and stream consumer
    - Create POST /notifications handler with validation: channel (slack/email/pagerduty), recipients (at least one), message (non-empty), incidentId
    - Implement delivery handlers (stub implementations for Slack, email, PagerDuty)
    - Record notification with status tracking (pending → delivered/failed)
    - Implement retry logic: up to 3 attempts on failure with exponential backoff
    - Create GET /incidents/:id/notifications returning notifications ordered by timestamp ascending
    - Also consume from Redis Stream `notifications` for event-driven delivery
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 9.2 Implement escalation policy CRUD
    - Create POST /escalation-policies handler with validation: name (1-200 chars), levels (1-10), each level has targets (at least one), notifyAfter (1-1440 minutes), channels (at least one valid)
    - Validate strictly increasing notifyAfter values across levels
    - Create GET /escalation-policies and GET /escalation-policies/:id
    - Return 400 for validation errors (ordering violation, missing fields, invalid channels)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 9.3 Write property test for escalation policy validation (Property 21)
    - **Property 21: Escalation policy level ordering** — For any policy with multiple levels, verify acceptance iff notifyAfter values are strictly increasing
    - **Validates: Requirements 11.2, 11.3**

  - [x] 9.4 Implement auto-escalation timer system
    - Consume from Redis Stream `incident-events` for status changes
    - On incident status change, cancel pending escalation timers and reset sequence
    - Set timers based on escalation policy levels; trigger notifications when thresholds exceeded
    - Send notifications through all channels specified in the triggered level
    - Create "escalation" timeline entry via HTTP callback to incident-engine
    - Stop further escalation after all levels exhausted until next status change
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 9.5 Write property test for escalation timer cancellation (Property 22)
    - **Property 22: Status change cancels escalation timers** — For any incident with active timers, verify status transition cancels all pending timers
    - **Validates: Requirements 12.4**

- [ ] 10. Implement analytics-service
  - [x] 10.1 Implement MTTR computation endpoint
    - Create GET /metrics/mttr handler
    - Compute mean time to resolve per severity: arithmetic mean of (resolvedAt - declaredAt) in minutes for resolved incidents
    - Return zero for severity levels with no resolved incidents
    - Implement Redis caching with 10-minute TTL (`cache:mttr`)
    - Return 503 if database unavailable
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 10.2 Write property tests for MTTR (Property 23)
    - **Property 23: MTTR computation correctness** — For any set of resolved incidents, verify arithmetic mean per severity, zero for empty, non-negative values
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [x] 10.3 Implement frequency, trends, and severity distribution endpoints
    - Create GET /metrics/frequency with time range and interval (daily/weekly/monthly); return contiguous buckets with zero-fill
    - Create GET /metrics/trends computing week-over-week percentage changes for last 4 weeks; null when previous week is zero
    - Create GET /metrics/severity-distribution returning counts for all four severity levels (including zero)
    - Implement Redis caching with 10-minute TTL
    - Return 400 for invalid time ranges (end before start, > 365 days)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [ ]* 10.4 Write property tests for frequency and trends (Properties 24, 25, 26)
    - **Property 24: Frequency bucketing with zero-fill** — For any time range and interval, verify contiguous buckets with no gaps
    - **Property 25: Week-over-week trend computation** — Verify ((current - previous) / previous) × 100, null when previous is zero
    - **Property 26: Severity distribution completeness** — Verify all four severity levels always returned
    - **Validates: Requirements 14.1-14.4**

  - [x] 10.5 Implement recurring patterns and team performance endpoints
    - Create GET /metrics/recurring-patterns: services appearing in >1 incident within 30-day window, top 10, ordered by count descending
    - Create GET /metrics/team-performance: mean response time (declaredAt to first assignment) and mean resolution time (declaredAt to resolvedAt) per responder
    - Implement Redis caching with 10-minute TTL
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [ ]* 10.6 Write property tests for patterns and team metrics (Properties 27, 28)
    - **Property 27: Recurring pattern identification** — Verify services with >1 incident returned, top 10, ordered by count
    - **Property 28: Team performance metrics computation** — Verify arithmetic mean of response/resolution times per responder
    - **Validates: Requirements 15.1-15.4**

- [x] 11. Checkpoint - Ensure all service tests pass
  - Ensure all unit and property tests pass across all four services. Ask the user if questions arise.

- [ ] 12. Integration wiring and cross-service communication
  - [x] 12.1 Wire Redis Stream event publishing from incident-engine
    - Publish `IncidentEvent` to `incident-events` stream on: incident declared, status changed, severity changed, responder assigned
    - Publish `NotificationRequest` to `notifications` stream when notifications need sending
    - Publish runbook execution events to `runbook-executions` stream
    - _Requirements: 9.1, 10.1, 12.1_

  - [x] 12.2 Wire incident-engine data persistence and error handling
    - Implement transactional consistency: all creates/updates fully commit or rollback
    - Implement cascade deletion for timeline entries on incident delete
    - Handle database unavailability: return 503 with no partial records on writes, 503 on reads
    - Implement JSON serialization round-trip correctness for all API responses
    - _Requirements: 20.1, 20.3, 20.4, 20.5, 20.6_

  - [ ]* 12.3 Write property test for serialization round-trip (Property 31)
    - **Property 31: Incident JSON serialization round-trip** — For any valid incident, verify serializing and parsing produces semantically equivalent document
    - **Validates: Requirements 20.2, 20.3**

  - [ ]* 12.4 Write integration tests for cross-service communication
    - Test Redis Stream publish/consume for runbook execution flow
    - Test Redis Stream publish/consume for notification delivery flow
    - Test PostgreSQL transaction rollback on failure
    - Test cascade deletion of timeline entries
    - Test health/readiness probe behavior with dependencies up/down
    - Test auto-escalation timer triggering
    - Test concurrent status transition serialization with advisory locks
    - _Requirements: 9.1, 10.1, 12.1, 16.2, 16.3, 17.5, 20.4, 20.5_

- [x] 13. Dockerization and Kubernetes deployment manifests
  - [x] 13.1 Create Dockerfiles and Kubernetes manifests
    - Create Dockerfile for each service (multi-stage build: build → production)
    - Create `k8s/` directory with Deployment, Service, ConfigMap, and Secret manifests for each service
    - Configure liveness probes pointing to /health and readiness probes pointing to /ready
    - Create `k8s/postgres.yml` and `k8s/redis.yml` for StatefulSets
    - Update `docker-compose.yml` to build and run all services together for local development
    - _Requirements: 16.1-16.8_

  - [x] 13.2 Create CI/CD configuration and GitHub repository setup
    - Create `.github/workflows/ci.yml` with: lint, type-check, unit tests, property tests, build Docker images
    - Create `README.md` with project overview, architecture diagram, setup instructions, and development workflow
    - Ensure `npm run test` exits cleanly with all tests passing
    - _Requirements: All_

- [x] 14. Final checkpoint - Full integration verification
  - Ensure all tests pass (unit, property, integration), Docker builds succeed, and the project is ready for GitHub push. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based test tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests use `fast-check` with minimum 100 iterations per property
- Integration tests require Docker (PostgreSQL + Redis) to be running
- The monorepo uses npm workspaces for dependency management
- All services share types via `packages/shared-types`
- Advisory locks ensure concurrent transition safety without global locking

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["3.1", "3.3", "3.5"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.6", "4.1", "4.3", "4.5"] },
    { "id": 4, "tasks": ["4.2", "4.4", "4.6", "6.1", "6.3"] },
    { "id": 5, "tasks": ["6.2", "6.4", "6.5", "6.7"] },
    { "id": 6, "tasks": ["6.6", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3"] },
    { "id": 8, "tasks": ["7.4", "9.1", "9.2"] },
    { "id": 9, "tasks": ["9.3", "9.4", "10.1"] },
    { "id": 10, "tasks": ["9.5", "10.2", "10.3", "10.5"] },
    { "id": 11, "tasks": ["10.4", "10.6"] },
    { "id": 12, "tasks": ["12.1", "12.2"] },
    { "id": 13, "tasks": ["12.3", "12.4"] },
    { "id": 14, "tasks": ["13.1", "13.2"] }
  ]
}
```
