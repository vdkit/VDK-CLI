import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use the supported CLI entrypoint and focused Vitest coverage instead of this retired refactor harness.',
    'Use `pnpm run health-check` for package-level integrity checks.',
  ],
  script: 'scripts/verify-refactor.ts',
});
