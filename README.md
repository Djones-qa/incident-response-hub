# Incident Response Hub

[![CI](https://github.com/Djones-qa/incident-response-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/Djones-qa/incident-response-hub/actions/workflows/ci.yml)
[![TypeScript 5.3](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js 20](https://img.shields.io/badge/Node.js-20-green?logo=node.js)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue?logo=postgresql)](https://www.postgresql.org/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28-blue?logo=kubernetes)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Incident response & post-mortem management platform. A distributed system for managing the full lifecycle of production incidents — from declaration through investigation, mitigation, resolution, and post-mortem analysis.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                            │
│                                                                   │
│  ┌──────────────────┐  ┌─────────────────────┐  ┌────────────┐ │
│  │ incident-engine  │  │notification-service  │  │ analytics  │ │
│  │   (port 4000)    │  │    (port 4001)       │  │(port 4002) │ │
│  └────────┬─────────┘  └──────────┬──────────┘  └─────┬──────┘ │
│           │                        │                    │         │
│           └───────────┬────────────┴────────────────────┘         │
│                       │                                           │
│              ┌────────▼────────┐                                  │
│              │  runbook-worker │                                  │
│              │   (consumer)    │                                  │
│              └────────┬────────┘                                  │
│                       │                                           │
│           ┌───────────┴───────────┐                               │
│           │                       │                               │
│     ┌─────▼─────┐         ┌──────▼──────┐                        │
│     │PostgreSQL │         │    Redis     │                        │
│     │   (15)    │         │     (7)      │                        │
│     └───────────┘         └─────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| **incident-engine** | 4000 | Core domain logic — incidents, timelines, severity, status, responders, post-mortems, runbooks, trigger matching |
| **notification-service** | 4001 | Notification delivery, escalation policies, auto-escalation timers |
| **analytics-service** | 4002 | MTTR, frequency, trends, recurring patterns, team performance |
| **runbook-worker** | — | Background consumer — executes runbook steps, handles retries/rollback, reports progress |

### Communication

Services communicate via Redis Streams for event-driven, loosely-coupled interactions:

- `stream:runbook-executions` — Trigger runbook execution
- `stream:notifications` — Send notification requests
- `stream:incident-events` — Incident state changes for auto-escalation
- `stream:execution-progress` — Runbook step progress reporting

## Quick Start

```bash
# Start infrastructure (PostgreSQL + Redis)
docker-compose up -d

# Wait for services to be healthy
docker-compose ps

# Services will be available at:
# - incident-engine:      http://localhost:4000
# - notification-service: http://localhost:4001
# - analytics-service:    http://localhost:4002
```

## Development Setup

```bash
# Prerequisites: Node.js 20+, Docker

# Install dependencies
npm install

# Build all packages and services
npm run build

# Run all tests
npm test

# Run specific test suites
npm run test:unit        # Unit tests only
npm run test:property    # Property-based tests only
npm run test:integration # Integration tests (requires Docker)
```

## API Endpoints

### incident-engine (port 4000)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/incidents` | Declare a new incident |
| GET | `/incidents` | List incidents with filters |
| GET | `/incidents/:id` | Get incident by ID |
| PATCH | `/incidents/:id/status` | Transition status |
| PATCH | `/incidents/:id/severity` | Escalate severity |
| POST | `/incidents/:id/responders` | Assign responders |
| POST | `/incidents/:id/timeline` | Add timeline entry |
| GET | `/incidents/:id/timeline` | Get incident timeline |
| POST | `/incidents/:id/postmortem` | Generate post-mortem |
| GET | `/incidents/:id/postmortem` | Get post-mortem |
| POST | `/runbooks` | Create runbook |
| GET | `/runbooks` | List runbooks |
| GET | `/runbooks/:id` | Get runbook |
| POST | `/runbooks/:id/execute` | Trigger execution |
| GET | `/incidents/:id/suggested-runbooks` | Get matching runbooks |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

### notification-service (port 4001)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/notifications` | Send notification |
| GET | `/incidents/:id/notifications` | List notifications for incident |
| POST | `/escalation-policies` | Create escalation policy |
| GET | `/escalation-policies` | List policies |
| GET | `/escalation-policies/:id` | Get policy |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

### analytics-service (port 4002)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metrics/mttr` | MTTR by severity |
| GET | `/metrics/frequency` | Incident frequency over time |
| GET | `/metrics/trends` | Week-over-week trends |
| GET | `/metrics/severity-distribution` | Severity distribution |
| GET | `/metrics/recurring-patterns` | Recurring service patterns |
| GET | `/metrics/team-performance` | Team response metrics |
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |

## Technology Stack

| Category | Technology |
|----------|-----------|
| Language | TypeScript 5.3 |
| Runtime | Node.js 20 |
| Framework | Express.js |
| Database | PostgreSQL 15 |
| Cache/Streams | Redis 7 |
| Orchestration | Kubernetes 1.28 |
| Containerization | Docker |
| CI/CD | GitHub Actions |
| Testing | Jest + fast-check (property-based) |
| Linting | ESLint + Prettier |

## Project Structure

```
incident-response-hub/
├── packages/
│   ├── shared-types/       # Shared TypeScript interfaces
│   ├── shared-utils/       # Common utilities (validation, dates, errors)
│   └── test-helpers/       # Shared test generators and helpers
├── services/
│   ├── incident-engine/    # Core incident management service
│   ├── notification-service/ # Notification & escalation service
│   ├── analytics-service/  # Metrics & analytics service
│   └── runbook-worker/     # Background runbook executor
├── k8s/                    # Kubernetes manifests
├── scripts/                # Development & operational scripts
├── docker-compose.yml      # Local development infrastructure
└── .github/workflows/      # CI/CD pipeline
```

## Incident Lifecycle

```
declared → investigating → mitigating → resolved → closed
```

- Transitions are strictly linear (no backwards, no skipping)
- Severity can only escalate (low → medium → high → critical) during active statuses
- Resolution requires a timeline entry of type "resolution"
- Post-mortems are auto-generated from incident data on demand

## Author

**Darrius Jones** ([@Djones-qa](https://github.com/Djones-qa))

## License

MIT © 2024 Darrius Jones
