import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/services'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/*.test.ts',
    '**/*.spec.ts',
  ],
  moduleNameMapper: {
    '^@incident-hub/shared-types$': '<rootDir>/packages/shared-types/src/index.ts',
    '^@incident-hub/shared-utils$': '<rootDir>/packages/shared-utils/src/index.ts',
    '^@incident-hub/test-helpers$': '<rootDir>/packages/test-helpers/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: [
    '**/src/**/*.ts',
    '!**/src/**/index.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  passWithNoTests: true,
};

export default config;
