import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use normal shell tooling like `ls`, `find`, or `rg` for local debugging.',
    'Use `pnpm run health-check` for package-level integrity checks.',
  ],
  script: 'scripts/debug.ts',
});
