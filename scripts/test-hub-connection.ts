import { runRetiredScript } from './retired-script.js';

runRetiredScript({
  guidance: [
    'Use supported CLI commands and focused Vitest cases for Hub integration checks.',
    'Avoid relying on this retired manual network harness.',
  ],
  script: 'scripts/test-hub-connection.ts',
});
