import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use `vdk schema-migrate` for schema v3 migration work.',
    'Use focused Vitest coverage for adapter behavior instead of this retired harness.',
  ],
  script: 'scripts/test-v3-adapter.ts',
});
