/**
 * Duplicate Rule Checker
 *
 * Scans blueprint rule artifacts and reports duplicate rule IDs.
 */

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import glob from 'fast-glob';
import matter from 'gray-matter';
import { z } from 'zod';

const DEFAULT_RULES_DIRECTORY = '.vdk/blueprints/rules';
const RULE_FILE_PATTERNS = ['**/*.md', '**/*.mdc'];
const RULE_FILE_IGNORE_PATTERNS = ['**/README.md', '**/CONTRIBUTING.md', '**/CHANGELOG.md'];

const duplicateEntrySchema = z.strictObject({
  ruleId: z.string().min(1),
  paths: z.array(z.string()).min(2),
});

const duplicateCheckResultSchema = z.strictObject({
  checkedDirectory: z.string().min(1),
  filesScanned: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  duplicates: z.array(duplicateEntrySchema),
});

type DuplicateCheckOptions = {
  json: boolean;
  path: string;
};

export type DuplicateEntry = z.infer<typeof duplicateEntrySchema>;
export type DuplicateCheckResult = z.infer<typeof duplicateCheckResultSchema>;

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

function extractRuleId(filePath: string, content: string): string {
  const parsed = matter(content);
  const frontmatterSchema = z.object({ id: z.string().trim().min(1) }).partial();
  const frontmatterResult = frontmatterSchema.safeParse(parsed.data);

  if (frontmatterResult.success && frontmatterResult.data.id !== undefined) {
    return frontmatterResult.data.id.toLowerCase();
  }

  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

export async function checkDuplicateRules(
  rulesDirectory = DEFAULT_RULES_DIRECTORY
): Promise<DuplicateCheckResult> {
  const resolvedDirectory = path.resolve(rulesDirectory);
  const files = await collectRuleFiles(resolvedDirectory);
  const rulePaths = new Map<string, string[]>();

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const ruleId = extractRuleId(filePath, content);
    const existingPaths = rulePaths.get(ruleId);

    if (existingPaths === undefined) {
      rulePaths.set(ruleId, [filePath]);
      continue;
    }

    existingPaths.push(filePath);
  }

  const duplicates = Array.from(rulePaths.entries())
    .filter(([, filePaths]) => filePaths.length > 1)
    .map(([ruleId, filePaths]) => ({
      ruleId,
      paths: [...filePaths].toSorted(),
    }))
    .toSorted((left, right) => left.ruleId.localeCompare(right.ruleId));

  return duplicateCheckResultSchema.parse({
    checkedDirectory: resolvedDirectory,
    duplicateCount: duplicates.length,
    duplicates,
    filesScanned: files.length,
  });
}

function renderResult(result: DuplicateCheckResult): void {
  writeStdout(chalk.blue.bold('Checking blueprint rules for duplicate IDs'));
  writeStdout(chalk.dim(`Directory: ${result.checkedDirectory}`));
  writeStdout('');

  if (result.filesScanned === 0) {
    writeStdout(chalk.yellow('No blueprint rule files were found.'));
    return;
  }

  writeStdout(chalk.cyan(`Files scanned: ${result.filesScanned}`));

  if (result.duplicateCount === 0) {
    writeStdout(chalk.green('No duplicate rule IDs found.'));
    return;
  }

  writeStderr(chalk.red(`Duplicate IDs found: ${result.duplicateCount}`));

  for (const duplicate of result.duplicates) {
    writeStderr('');
    writeStderr(chalk.red(`- ${duplicate.ruleId}`));

    for (const duplicatePath of duplicate.paths) {
      writeStderr(chalk.red(`  ${duplicatePath}`));
    }
  }
}

async function runDuplicateCheckCli(options: DuplicateCheckOptions): Promise<number> {
  const resolvedDirectory = path.resolve(options.path);
  const directoryExists = await pathExists(resolvedDirectory);

  if (!directoryExists) {
    writeStdout(
      chalk.yellow(
        `No blueprint rules directory found at ${resolvedDirectory}. Nothing to check yet.`
      )
    );
    return options.path === DEFAULT_RULES_DIRECTORY ? 0 : 1;
  }

  const result = await checkDuplicateRules(resolvedDirectory);

  if (options.json) {
    writeStdout(JSON.stringify(result, null, 2));
  } else {
    renderResult(result);
  }

  return result.duplicateCount === 0 ? 0 : 1;
}

export async function runDuplicateCheckCliFromArgv(argv: string[] = process.argv): Promise<number> {
  const normalizedArgv = normalizeArgv(argv);
  const program = new Command()
    .name('check-duplicates')
    .description('Check blueprint rule artifacts for duplicate rule IDs')
    .showHelpAfterError('(add --help for usage information)')
    .option('--json', 'Output the report as JSON', false)
    .option('-p, --path <path>', 'Blueprint rule directory to scan', DEFAULT_RULES_DIRECTORY)
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

  return await runDuplicateCheckCli(program.opts<DuplicateCheckOptions>());
}

if (isMainModule()) {
  runDuplicateCheckCliFromArgv().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      writeStderr(chalk.red(`Duplicate check failed: ${formatError(error)}`));
      process.exitCode = 1;
    }
  );
}
