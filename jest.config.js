/**
 * Tests cover the deterministic core only -- day boundaries, grading, scheduling,
 * JSON recovery and schema dialects. No component tests: the value here is in the
 * logic that silently corrupts data when it is wrong, not in render output.
 */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    // Assets first: the general `@/` rule would otherwise swallow it.
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  clearMocks: true,
};
