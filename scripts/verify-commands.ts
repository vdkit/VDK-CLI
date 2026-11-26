import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use `vdk --help` and command-level `--help` output for CLI smoke tests.',
    'Use `pnpm exec vitest run tests/cli.test.ts` for automated CLI verification.',
  ],
  script: 'scripts/verify-commands.ts',
});
