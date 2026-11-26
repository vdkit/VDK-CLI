import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use `cli.js` and the registered command help output for CLI verification.',
    'Use `pnpm exec vitest run tests/cli.test.ts` for automated CLI checks.',
  ],
  script: 'scripts/test-new-cli.ts',
});
