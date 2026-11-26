/**
 * Blueprint rule validator.
 *
 * Validates MDC and Markdown rule artifacts against the shared schema package.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import glob from 'fast-glob';
import { z } from 'zod';

import { fileValidation } from '../utils/schema-validator.js';

const DEFAULT_RULES_DIRECTORY = '.vdk/blueprints/rules';
const RULE_FILE_PATTERNS = ['**/*.md', '**/*.mdc'];
const RULE_FILE_IGNORE_PATTERNS = ['**/README.md', '**/CONTRIBUTING.md', '**/CHANGELOG.md'];

const invalidFileSchema = z.strictObject({
  errors: z.array(z.string()),
  file: z.string().min(1),
});

const duplicateRuleSchema = z.strictObject({
  current: z.string().min(1),
  existing: z.string().min(1),
});

const rawValidationResultSchema = z.strictObject({
  duplicateIds: z.map(z.string(), duplicateRuleSchema),
  invalid: z.array(invalidFileSchema),
  valid: z.array(z.string()),
  warnings: z.array(z.string()).optional().default([]),
});

const validationReportSchema = z.strictObject({
  checkedDirectory: z.string().min(1),
  duplicateIds: z.array(
    z.strictObject({
      current: z.string().min(1),
      existing: z.string().min(1),
      ruleId: z.string().min(1),
    })
  ),
  filesScanned: z.number().int().nonnegative(),
  invalid: z.array(invalidFileSchema),
  valid: z.array(z.string()),
  warnings: z.array(z.string()),
});

type ValidationCliOptions = {
  json: boolean;
  path: string;
};

export type InvalidFile = z.infer<typeof invalidFileSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;

const modulePath = fileURLToPath(import.meta.url);

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }

  return path.resolve(process.argv[1]) === modulePath;
}

function normalizeArgv(argv: string[]): string[] {
  if (argv[2] === '--') {
    return [argv[0], argv[1], ...argv.slice(3)];
  }

  return argv;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectRuleFiles(rulesDirectory: string): Promise<string[]> {
  return await glob(RULE_FILE_PATTERNS, {
    absolute: true,
    cwd: rulesDirectory,
    ignore: RULE_FILE_IGNORE_PATTERNS,
    onlyFiles: true,
  });
}

function normalizeValidationResult(rawResult: unknown, checkedDirectory: string): ValidationReport {
  const parsedResult = rawValidationResultSchema.parse(rawResult);
  const duplicateIds = Array.from(parsedResult.duplicateIds.entries())
    .map(([ruleId, paths]) => ({
      current: paths.current,
      existing: paths.existing,
      ruleId,
    }))
    .toSorted((left, right) => left.ruleId.localeCompare(right.ruleId));

  return validationReportSchema.parse({
    checkedDirectory,
    duplicateIds,
    filesScanned: parsedResult.valid.length + parsedResult.invalid.length,
    invalid: parsedResult.invalid,
    valid: parsedResult.valid,
    warnings: parsedResult.warnings,
  });
}

export async function validateRules(
  rulesDirectory = DEFAULT_RULES_DIRECTORY
): Promise<ValidationReport> {
  const resolvedDirectory = path.resolve(rulesDirectory);
  const files = await collectRuleFiles(resolvedDirectory);
  const rawResult = await fileValidation.validateMDCFiles(files);

  return normalizeValidationResult(rawResult, resolvedDirectory);
}

function renderValidationReport(report: ValidationReport): void {
  writeStdout(chalk.blue.bold('Validating blueprint rule artifacts'));
  writeStdout(chalk.dim(`Directory: ${report.checkedDirectory}`));
  writeStdout('');

  if (report.filesScanned === 0) {
    writeStdout(chalk.yellow('No blueprint rule files were found.'));
    return;
  }

  for (const validFile of report.valid) {
    writeStdout(chalk.green(`  OK  ${validFile}`));
  }

  for (const invalidFile of report.invalid) {
    writeStderr(chalk.red(`  ERR ${invalidFile.file}`));

    for (const error of invalidFile.errors) {
      writeStderr(chalk.red(`      ${error}`));
    }
  }

  for (const warning of report.warnings) {
    writeStdout(chalk.yellow(`  WARN ${warning}`));
  }

  for (const duplicate of report.duplicateIds) {
    writeStderr(chalk.red(`  DUP ${duplicate.ruleId}`));
    writeStderr(chalk.red(`      Existing: ${duplicate.existing}`));
    writeStderr(chalk.red(`      Current:  ${duplicate.current}`));
  }

  writeStdout('');
  writeStdout(chalk.cyan(`Files scanned: ${report.filesScanned}`));
  writeStdout(chalk.cyan(`Valid files: ${report.valid.length}`));
  writeStderr(chalk.red(`Invalid files: ${report.invalid.length}`));
  writeStderr(chalk.red(`Duplicate IDs: ${report.duplicateIds.length}`));

  if (report.invalid.length === 0 && report.duplicateIds.length === 0) {
    writeStdout(chalk.green('All blueprint rule files passed validation.'));
  }
}

async function runValidationCli(options: ValidationCliOptions): Promise<number> {
  const resolvedDirectory = path.resolve(options.path);
  const directoryExists = await pathExists(resolvedDirectory);

  if (!directoryExists) {
    writeStdout(
      chalk.yellow(
        `No blueprint rules directory found at ${resolvedDirectory}. Nothing to validate yet.`
      )
    );
    return options.path === DEFAULT_RULES_DIRECTORY ? 0 : 1;
  }

  const report = await validateRules(resolvedDirectory);

  if (options.json) {
    writeStdout(JSON.stringify(report, null, 2));
  } else {
    renderValidationReport(report);
  }

  return report.invalid.length === 0 && report.duplicateIds.length === 0 ? 0 : 1;
}

export async function runValidationCliFromArgv(argv: string[] = process.argv): Promise<number> {
  const normalizedArgv = normalizeArgv(argv);
  const program = new Command()
    .name('validate-rules')
    .description('Validate blueprint rule artifacts against the shared schema definitions')
    .showHelpAfterError('(add --help for usage information)')
    .option('--json', 'Output the validation report as JSON', false)
    .option('-p, --path <path>', 'Blueprint rule directory to validate', DEFAULT_RULES_DIRECTORY)
    .configureOutput({
      writeErr: writeStderr,
      writeOut: writeStdout,
    })
    .exitOverride();

  try {
    await program.parseAsync(normalizedArgv);
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 1 ? 2 : error.exitCode;
    }

    throw error;
  }

  return await runValidationCli(program.opts<ValidationCliOptions>());
}

if (isMainModule()) {
  runValidationCliFromArgv().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      writeStderr(chalk.red(`Validation failed: ${formatError(error)}`));
      process.exitCode = 1;
    }
  );
}
