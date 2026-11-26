import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'The Vitest suite now lives under `tests/**/*.ts`.',
    'Edit the relevant test files directly and validate with `pnpm exec vitest run <test-file>`.',
  ],
  script: 'scripts/fix-tests.ts',
});
