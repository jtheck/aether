import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkRules, computeRulesHash, rulesFiles } from './sim-rules.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(generation = 4) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aether-sim-rules-'));
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, 'src', 'sim'), { recursive: true }),
    mkdir(path.join(root, 'src', 'app'), { recursive: true }),
    mkdir(path.join(root, 'src', 'render'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(root, 'src', 'sim', 'generation.js'),
      `export const SIM_GENERATION = ${generation};\n`,
    ),
    writeFile(path.join(root, 'src', 'sim', 'step.js'), 'export const step = () => 1;\n'),
    writeFile(path.join(root, 'src', 'sim', 'step.test.js'), 'ignored test\n'),
    writeFile(path.join(root, 'src', 'sim', 'scale.bench.js'), 'ignored bench\n'),
    writeFile(path.join(root, 'src', 'app', 'sim.worker.js'), 'export const tick = 1;\n'),
    writeFile(path.join(root, 'src', 'render', 'shader.js'), 'ignored render\n'),
    writeFile(
      path.join(root, 'src', 'sim', 'rulesEpoch.js'),
      `export const SIM_RULES_GENERATION = ${generation};\n`
        + `export const SIM_RULES_SHA256 = '${'0'.repeat(64)}';\n`,
    ),
  ]);
  const hash = await computeRulesHash(root);
  await writeFile(
    path.join(root, 'src', 'sim', 'rulesEpoch.js'),
    `export const SIM_RULES_GENERATION = ${generation};\n`
      + `export const SIM_RULES_SHA256 = '${hash}';\n`,
  );
  return root;
}

describe('simulation rules fingerprint', () => {
  it('covers deterministic sources but ignores tests, benchmarks, render code, and line endings', async () => {
    const root = await fixture();
    assert.deepEqual(await rulesFiles(root), [
      'src/app/sim.worker.js',
      'src/sim/generation.js',
      'src/sim/step.js',
    ]);
    const initial = await computeRulesHash(root);

    await writeFile(path.join(root, 'src', 'sim', 'step.test.js'), 'changed test\n');
    await writeFile(path.join(root, 'src', 'render', 'shader.js'), 'changed shader\n');
    const step = await readFile(path.join(root, 'src', 'sim', 'step.js'), 'utf8');
    await writeFile(path.join(root, 'src', 'sim', 'step.js'), step.replace(/\n/g, '\r\n'));
    assert.equal(await computeRulesHash(root), initial);

    await writeFile(path.join(root, 'src', 'app', 'sim.worker.js'), 'export const tick = 2;\n');
    assert.notEqual(await computeRulesHash(root), initial);
  });

  it('refuses to bless changed rules until the generation advances', async () => {
    const root = await fixture(4);
    await checkRules({ root });
    await writeFile(path.join(root, 'src', 'sim', 'step.js'), 'export const step = () => 2;\n');

    await assert.rejects(
      checkRules({ root, write: true }),
      /Advance SIM_GENERATION above 4 first/,
    );

    await writeFile(
      path.join(root, 'src', 'sim', 'generation.js'),
      'export const SIM_GENERATION = 5;\n',
    );
    const updated = await checkRules({ root, write: true });
    assert.equal(updated.changed, true);
    assert.equal(updated.epochGeneration, 5);
    await checkRules({ root });
  });
});
