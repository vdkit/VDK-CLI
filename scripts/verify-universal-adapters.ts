import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use focused Vitest coverage for adapter behavior instead of this retired manual harness.',
    'Prefer supported CLI commands and targeted tests over one-off runtime scripts.',
  ],
  script: 'scripts/verify-universal-adapters.ts',
});
