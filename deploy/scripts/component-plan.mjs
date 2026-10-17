import { planComponent } from './component-target.mjs';
try {
  const plan = await planComponent(process.env);
  console.info(`${plan.empty} ${plan.pending}`);
} catch {
  console.error(
    JSON.stringify({
      event: 'component_plan_failed',
      instruction: 'Verify component compatibility, target configuration and migration history',
    }),
  );
  process.exitCode = 1;
}
