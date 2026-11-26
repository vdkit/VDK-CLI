/**
 * Centralized Console Utilities
 *
 * Consolidates all chalk styling and ora spinner functionality
 * to reduce duplication and ensure consistent output formatting.
 */

import chalk from 'chalk';
import ora, { type Options as OraOptions, type Ora } from 'ora';

type TableValue = boolean | number | string | null | undefined;

const writeStdout = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const writeStderr = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

/**
 * Styled console output utilities
 */
export const logger = {
  success: (message: string): void => writeStdout(chalk.green(`✅ ${message}`)),
  error: (message: string): void => writeStderr(chalk.red(`❌ ${message}`)),
  warning: (message: string): void => writeStdout(chalk.yellow(`⚠️  ${message}`)),
  info: (message: string): void => writeStdout(chalk.blue(`ℹ️  ${message}`)),

  // Standard chalk colors without icons
  green: (message: string): void => writeStdout(chalk.green(message)),
  red: (message: string): void => writeStderr(chalk.red(message)),
  yellow: (message: string): void => writeStdout(chalk.yellow(message)),
  blue: (message: string): void => writeStdout(chalk.blue(message)),
  cyan: (message: string): void => writeStdout(chalk.cyan(message)),
  gray: (message: string): void => writeStdout(chalk.gray(message)),

  // Formatted output
  title: (message: string): void => writeStdout(chalk.bold.blue(message)),
  subtitle: (message: string): void => writeStdout(chalk.cyan(message)),

  // Special formatting
  dim: (message: string): void => writeStdout(chalk.dim(message)),
  bold: (message: string): void => writeStdout(chalk.bold(message)),

  // Empty line
  blank: (): void => writeStdout(''),

  // Raw chalk access for complex styling
  chalk,
};

/**
 * Spinner utilities with consistent styling
 */
export const spinner = {
  create: (text: string, options: OraOptions = {}): Ora => {
    return ora({
      text: chalk.blue(text),
      color: 'blue',
      ...options,
    });
  },

  // Common spinner patterns
  start: (text: string): Ora => {
    const activeSpinner = ora({
      text: chalk.blue(text),
      color: 'blue',
    }).start();
    return activeSpinner;
  },

  succeed: (activeSpinner: Ora, text: string): void => {
    activeSpinner.succeed(chalk.green(text));
  },

  fail: (activeSpinner: Ora, text: string): void => {
    activeSpinner.fail(chalk.red(text));
  },

  warn: (activeSpinner: Ora, text: string): void => {
    activeSpinner.warn(chalk.yellow(text));
  },

  info: (activeSpinner: Ora, text: string): void => {
    activeSpinner.info(chalk.blue(text));
  },
};

/**
 * Progress indicators
 */
export const progress = {
  step: (current: number, total: number, message: string): void => {
    const prefix = chalk.gray(`[${current}/${total}]`);
    writeStdout(`${prefix} ${chalk.blue(message)}`);
  },

  checkmark: (message: string): void => {
    writeStdout(chalk.green(`  ✓ ${message}`));
  },

  cross: (message: string): void => {
    writeStderr(chalk.red(`  ✘ ${message}`));
  },

  bullet: (message: string): void => {
    writeStdout(chalk.gray(`  • ${message}`));
  },
};

/**
 * Validation output helpers
 */
export const validation = {
  valid: (file: string): void => {
    writeStdout(chalk.green(`  ✓ ${file}`));
  },

  invalid: (file: string, reason: string): void => {
    writeStderr(`${chalk.red(`  ✘ ${file}:`)} ${chalk.red(reason)}`);
  },

  warning: (file: string, reason: string): void => {
    writeStdout(`${chalk.yellow(`  ⚠ ${file}:`)} ${chalk.yellow(reason)}`);
  },

  summary: (valid: number, invalid: number, warnings = 0): void => {
    logger.blank();
    logger.title('Validation Summary:');
    logger.green(`  Valid files: ${valid}`);
    logger.red(`  Invalid files: ${invalid}`);
    if (warnings > 0) {
      logger.yellow(`  Warnings: ${warnings}`);
    }
  },
};

/**
 * Table formatting helpers
 */
export const table = {
  header: (columns: readonly string[]): void => {
    const formatted = columns.map(col => chalk.bold.blue(col)).join(' | ');
    writeStdout(formatted);
    writeStdout(chalk.gray('-'.repeat(formatted.length)));
  },

  row: (columns: readonly TableValue[]): void => {
    writeStdout(columns.map(column => String(column ?? '')).join(' | '));
  },
};

/**
 * Integration status helpers
 */
export const integration = {
  scanning: (name: string): void => logger.info(`Scanning ${name} integration...`),
  found: (name: string, confidence: number): void =>
    logger.success(`${name} detected (${confidence}% confidence)`),
  notFound: (name: string): void => logger.gray(`${name} not detected`),
  initialized: (name: string): void => logger.success(`${name} initialized successfully`),
  failed: (name: string, error: string): void =>
    logger.error(`Failed to initialize ${name}: ${error}`),
};

/**
 * File operation helpers
 */
export const file = {
  created: (filePath: string): void => logger.success(`Created ${filePath}`),
  updated: (filePath: string): void => logger.info(`Updated ${filePath}`),
  deleted: (filePath: string): void => logger.warning(`Deleted ${filePath}`),
  reading: (filePath: string): void => logger.dim(`Reading ${filePath}...`),
  writing: (filePath: string): void => logger.dim(`Writing ${filePath}...`),
};
