import type { Config } from 'jest';

const config: Config = {
  displayName: 'test-helpers',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: false,
    }],
  },
  moduleNameMapper: {
    '^@incident-hub/shared-types$': '<rootDir>/../shared-types/src/index.ts',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.test.ts',
  ],
};

export default config;
