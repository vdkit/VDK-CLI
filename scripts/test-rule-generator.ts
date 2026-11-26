import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use focused Vitest coverage for scanner and rule generation behavior.',
    'Prefer supported CLI commands and targeted tests over one-off runtime scripts.',
  ],
  script: 'scripts/test-rule-generator.ts',
});
