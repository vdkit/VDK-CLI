/**
 * Test Setup - Global configuration for all tests
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';

declare global {
  var TEST_CLI_ENTRY: string;
  var TEST_ROOT: string;
  var TEST_TIMEOUT: number;
  var TEST_TSX_LOADER: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set up global test environment
global.TEST_ROOT = path.dirname(__dirname);
global.TEST_CLI_ENTRY = path.join(global.TEST_ROOT, 'cli.ts');
global.TEST_TIMEOUT = 30000;
global.TEST_TSX_LOADER = path.join(global.TEST_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

// Mock environment variables for consistent testing
process.env.NODE_ENV = 'test';
process.env.VDK_TEST_MODE = 'true';

// Cleanup helper for temp files
afterEach(() => {
  // Clear any test-specific environment variables
  process.env.TEST_PROJECT_PATH = undefined;
});
