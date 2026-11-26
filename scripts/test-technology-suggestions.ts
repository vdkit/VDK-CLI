import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use focused Vitest coverage for scanner technology analysis behavior.',
    'Prefer supported CLI commands and targeted tests over one-off runtime scripts.',
  ],
  script: 'scripts/test-technology-suggestions.ts',
});
