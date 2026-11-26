import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use `pnpm exec vitest run tests/integrations.test.ts` for integration coverage.',
    'Use command-level help output and focused tests instead of this retired manual harness.',
  ],
  script: 'scripts/test-integration.ts',
});
