import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use `pnpm exec vitest run tests/validation.test.ts` for adapter and validation checks.',
    'Use command-level help output and focused tests instead of this retired manual harness.',
  ],
  script: 'scripts/test-adapter-integrity.ts',
});
