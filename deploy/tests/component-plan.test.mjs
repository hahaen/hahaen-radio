import { expect, it } from 'vitest';
import { runComponentPlan } from '../scripts/component-plan.mjs';
import { compatibleCombination } from '../scripts/component-state.mjs';

function output() {
  const lines = { info: [], error: [] };
  return {
    lines,
    info: (line) => lines.info.push(line),
    error: (line) => lines.error.push(line),
  };
}
it('preserves the machine-readable successful plan', async () => {
  const logger = output(),
    env = { CI: 'true' };
  expect(
    await runComponentPlan(
      env,
      async (received) => {
        expect(received).toBe(env);
        return { empty: false, pending: 0 };
      },
      logger,
    ),
  ).toBe(0);
  expect(logger.lines).toEqual({ info: ['false 0'], error: [] });
});
it('reports an actionable contract rejection from the real compatibility check', async () => {
  const logger = output();
  const installed = {
    format: 2,
    component: 'jobs',
    revision: 'a'.repeat(40),
    platform: 'linux/amd64',
    image: 'sha256:' + 'a'.repeat(64),
    migrationImage: null,
    migrations: [{ file: '0000_initial.sql', sha256: 'a'.repeat(64) }],
    contractHash: 'a'.repeat(64),
    compatibleContracts: [],
    compatibleSchemas: [],
    validationRun: 'a'.repeat(12),
  };
  expect(
    await runComponentPlan(
      {},
      async () => {
        compatibleCombination(
          { components: { jobs: installed } },
          { ...installed, component: 'api', contractHash: 'b'.repeat(64) },
        );
      },
      logger,
    ),
  ).toBe(1);
  expect(logger.lines.info).toEqual([]);
  expect(logger.lines.error).toHaveLength(1);
  expect(JSON.parse(logger.lines.error[0])).toMatchObject({
    event: 'component_plan_failed',
    reason: 'CONTRACT_INCOMPATIBLE',
    instruction: expect.stringContaining('deploy/compatibility/policy.json'),
  });
});
it('does not expose unexpected exception messages or environment values', async () => {
  const logger = output(),
    privateValue = 'private-fixture-value';
  expect(
    await runComponentPlan(
      { DB_PASSWORD: privateValue },
      async () => {
        throw Error(privateValue);
      },
      logger,
    ),
  ).toBe(1);
  expect(logger.lines.info).toEqual([]);
  expect(logger.lines.error).toHaveLength(1);
  expect(logger.lines.error[0]).not.toContain(privateValue);
  expect(JSON.parse(logger.lines.error[0])).toMatchObject({
    event: 'component_plan_failed',
    reason: 'TARGET_PREFLIGHT_FAILED',
  });
});
