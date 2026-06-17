#!/bin/bash
# Reset the database: drop all tables, re-run migrations, and seed data
# Usage: ./scripts/reset-db.sh
#
# Prerequisites: PostgreSQL container must be running (docker compose up postgres)

set -e

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-incident_response}"

echo "Resetting database ${DB_NAME}..."

# Drop and recreate database
PGPASSWORD="${DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "postgres" \
    -c "DROP DATABASE IF EXISTS ${DB_NAME};"

PGPASSWORD="${DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "postgres" \
    -c "CREATE DATABASE ${DB_NAME};"

echo "Running migrations..."

PGPASSWORD="${DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -f "$(dirname "$0")/../services/incident-engine/migrations/001_initial.sql"

PGPASSWORD="${DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -f "$(dirname "$0")/../services/incident-engine/migrations/002_indexes.sql"

echo "Seeding data..."

PGPASSWORD="${DB_PASSWORD}" psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -f "$(dirname "$0")/../services/incident-engine/migrations/003_seed.sql"

echo "Database reset complete."
