// One runner, three speed tiers via `projects`. @swc/jest does not type-check —
// run `npm run typecheck` for types.
const swc = {
  jsc: { parser: { syntax: "typescript" }, target: "es2022" },
  module: { type: "commonjs" },
};

const common = {
  testEnvironment: "node",
  transform: { "^.+\\.(t|j)s$": ["@swc/jest", swc] },
  moduleFileExtensions: ["ts", "js", "json"],
};

/** @type {import('jest').Config} */
module.exports = {
  // Tiers are scaffolded ahead of coverage; only pr-status has tests today.
  passWithNoTests: true,
  coverageProvider: "v8",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.d.ts"],
  // JUnit output only in CI (for Bitbucket Pipelines test reporting).
  reporters: process.env.CI
    ? ["default", ["jest-junit", { outputDirectory: "reports", outputName: "junit.xml" }]]
    : ["default"],
  projects: [
    {
      ...common,
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/*.unit.test.ts"],
    },
    {
      ...common,
      displayName: "int",
      testMatch: ["<rootDir>/src/**/*.int.test.ts"],
    },
    {
      ...common,
      displayName: "e2e",
      testMatch: ["<rootDir>/src/**/*.e2e.test.ts"],
    },
  ],
};
