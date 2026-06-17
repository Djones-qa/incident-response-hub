import type { Config } from 'jest';

const config: Config = {
  projects: [
    '<rootDir>/packages/*/jest.config.ts',
    '<rootDir>/services/*/jest.config.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: [
    '**/src/**/*.ts',
    '!**/src/**/index.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
};

export default config;
