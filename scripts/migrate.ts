import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use `vdk migrate` for project context migration.',
    'Use `vdk schema-migrate` for schema v3 blueprint migration.',
  ],
  script: 'scripts/migrate.ts',
});
