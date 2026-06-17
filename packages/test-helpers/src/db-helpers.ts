/**
 * Database test setup/teardown utilities.
 * Provides helpers for integration tests that require PostgreSQL.
 */

export interface DatabaseTestConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const DEFAULT_TEST_CONFIG: DatabaseTestConfig = {
  host: process.env['TEST_DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['TEST_DB_PORT'] ?? '5432', 10),
  database: process.env['TEST_DB_NAME'] ?? 'incident_hub_test',
  user: process.env['TEST_DB_USER'] ?? 'test',
  password: process.env['TEST_DB_PASSWORD'] ?? 'test',
};

/**
 * Creates a test database configuration. Override defaults via env vars or params.
 */
export function getTestDatabaseConfig(overrides?: Partial<DatabaseTestConfig>): DatabaseTestConfig {
  return { ...DEFAULT_TEST_CONFIG, ...overrides };
}

/**
 * Returns a PostgreSQL connection string for test database.
 */
export function getTestConnectionString(config?: Partial<DatabaseTestConfig>): string {
  const c = getTestDatabaseConfig(config);
  return `postgresql://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`;
}

/**
 * Table names used across services for cleanup.
 */
const ALL_TABLES = [
  'runbook_executions',
  'post_mortems',
  'timeline_entries',
  'incidents',
  'runbooks',
] as const;

/**
 * Truncates all tables in the test database.
 * Pass a query function that executes raw SQL (e.g., from pg Pool or knex).
 */
export async function truncateAllTables(
  queryFn: (sql: string) => Promise<unknown>
): Promise<void> {
  const tableList = ALL_TABLES.join(', ');
  await queryFn(`TRUNCATE TABLE ${tableList} CASCADE`);
}

/**
 * Drops and recreates the test schema.
 * Useful for full test suite reset.
 */
export async function resetTestSchema(
  queryFn: (sql: string) => Promise<unknown>
): Promise<void> {
  await queryFn('DROP SCHEMA IF EXISTS public CASCADE');
  await queryFn('CREATE SCHEMA public');
}

/**
 * Helper to create a database setup/teardown lifecycle for Jest.
 * Returns beforeAll/afterAll/afterEach hooks.
 */
export function createDatabaseLifecycle(
  connectFn: () => Promise<{ query: (sql: string) => Promise<unknown>; disconnect: () => Promise<void> }>
) {
  let db: { query: (sql: string) => Promise<unknown>; disconnect: () => Promise<void> } | null = null;

  return {
    async setup(): Promise<void> {
      db = await connectFn();
    },

    async teardown(): Promise<void> {
      if (db) {
        await db.disconnect();
        db = null;
      }
    },

    async cleanup(): Promise<void> {
      if (db) {
        await truncateAllTables(db.query.bind(db));
      }
    },

    getQuery(): (sql: string) => Promise<unknown> {
      if (!db) throw new Error('Database not connected. Call setup() first.');
      return db.query.bind(db);
    },
  };
}
