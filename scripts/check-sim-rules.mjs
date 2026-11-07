import { checkRules } from './sim-rules.mjs';

const write = process.argv.includes('--write');

try {
  const result = await checkRules({ write });
  const action = result.changed ? 'updated' : 'verified';
  console.log(`Simulation rules ${action}: generation ${result.generation}, ${result.hash.slice(0, 12)}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
