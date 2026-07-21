const common = {
  coveragePathIgnorePatterns: ['/node_modules/', '/service-sandbox/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
}

module.exports = {
  watchman: false,
  modulePathIgnorePatterns: [
    '<rootDir>/services/[^/]+/node_modules/',
  ],
  coverageReporters: ['html', 'text-summary'],
  // collectCoverageFrom: ['services/**/*.{js,ts}'],
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['**/tests/**/*.test.js'],
      testPathIgnorePatterns: ['\\.e2e\\.test\\.js$'],
      coverageDirectory: '<rootDir>/coverage/services-unit',
    },
    {
      ...common,
      displayName: 'e2e',
      testMatch: ['**/tests/**/*.e2e.test.js'],
      testTimeout: 30000,
      coverageDirectory: '<rootDir>/coverage/services-e2e',
    },
  ],
}
