import { planComponent } from './component-target.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runComponentPlan(env, plan = planComponent, output = console) {
  try {
    const result = await plan(env);
    output.info(`${result.empty} ${result.pending}`);
    return 0;
  } catch (error) {
    const incompatible =
      error instanceof Error &&
      error.message ===
        'Incompatible component contract; review an explicit compatibility declaration';
    output.error(
      JSON.stringify({
        event: 'component_plan_failed',
        reason: incompatible ? 'CONTRACT_INCOMPATIBLE' : 'TARGET_PREFLIGHT_FAILED',
        instruction: incompatible
          ? 'Review mixed-version compatibility and declare the installed contract hash in deploy/compatibility/policy.json'
          : 'Verify component compatibility, target configuration and migration history',
      }),
    );
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runComponentPlan(process.env);
}
