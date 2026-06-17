#!/bin/bash
# Seed development data into the PostgreSQL database
# Usage: ./scripts/seed.sh
#
# Prerequisites: PostgreSQL container must be running (docker compose up postgres)

set -e

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-incident_response}"

echo "Seeding development data into ${DB_NAME}..."

PGPASSWORD="${DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -f "$(dirname "$0")/../services/incident-engine/migrations/003_seed.sql"

echo "Seed data loaded successfully."
