/**
 * VDK CLI health checks for local package integrity.
 */

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import glob from 'fast-glob';
import { z } from 'zod';

const modulePath = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(modulePath), '../..');

const packageJsonSchema = z
  .object({
    bin: z.record(z.string(), z.string()).optional().default({}),
    engines: z.record(z.string(), z.string()).optional().default({}),
    scripts: z.record(z.string(), z.string()).optional().default({}),
    type: z.string().optional(),
  })
  .passthrough();

const healthCheckItemSchema = z.strictObject({
  details: z.array(z.string()),
  name: z.string().min(1),
  passed: z.boolean(),
});

const healthCheckReportSchema = z.strictObject({
  checks: z.array(healthCheckItemSchema),
  passed: z.boolean(),
  rootPath: z.string().min(1),
});

type HealthCheckCliOptions = {
  json: boolean;
  path: string;
};

export type HealthCheckItem = z.infer<typeof healthCheckItemSchema>;
export type HealthCheckReport = z.infer<typeof healthCheckReportSchema>;

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

function getRequiredSurface(rootPath: string): string[] {
  return [
    path.join(rootPath, 'cli.ts'),
    path.join(rootPath, 'package.json'),
    path.join(rootPath, 'lint/blueprint-lint-trigger.ts'),
    path.join(rootPath, 'src/scanner/index.ts'),
    path.join(rootPath, 'src/scanner/core/ProjectScanner.js'),
    path.join(rootPath, 'src/templates/commands/claude-code-command-template.md'),
    path.join(rootPath, 'tsconfig.build.json'),
    path.join(rootPath, 'src/utils/health-check.ts'),
    path.join(rootPath, 'src/utils/project-insights.ts'),
    path.join(rootPath, 'src/validation/check-duplicates.ts'),
    path.join(rootPath, 'src/validation/validate-rules.ts'),
  ];
}

function parseMajorVersion(versionRange: string | undefined): number | null {
  if (versionRange === undefined) {
    return null;
  }

  const match = versionRange.match(/(\d+)/);
  return match === null ? null : Number(match[1]);
}

async function runNodeVersionCheck(): Promise<HealthCheckItem> {
  const nodeVersion = process.versions.node;
  const majorVersion = Number(nodeVersion.split('.')[0]);

  return {
    details: [
      majorVersion >= 22
        ? `Runtime node version ${nodeVersion} satisfies the Node.js 22+ requirement.`
        : `Runtime node version ${nodeVersion} does not satisfy the Node.js 22+ requirement.`,
    ],
    name: 'Node.js runtime',
    passed: majorVersion >= 22,
  };
}

async function runPackageMetadataCheck(rootPath: string): Promise<HealthCheckItem> {
  const packageJsonPath = path.join(rootPath, 'package.json');
  const packageContent = await readFile(packageJsonPath, 'utf8');
  const packageJson = packageJsonSchema.parse(JSON.parse(packageContent));
  const details: string[] = [];
  let passed = true;

  if (packageJson.type !== 'module') {
    passed = false;
    details.push('package.json must set "type": "module".');
  } else {
    details.push('package.json uses ESM mode.');
  }

  const nodeEngineMajor = parseMajorVersion(packageJson.engines.node);
  if (nodeEngineMajor === null || nodeEngineMajor < 22) {
    passed = false;
    details.push('package.json must enforce Node.js 22+ in "engines.node".');
  } else {
    details.push(`package.json enforces Node.js ${packageJson.engines.node}.`);
  }

  if (packageJson.engines.pnpm === undefined) {
    passed = false;
    details.push('package.json must define "engines.pnpm".');
  } else {
    details.push(`package.json enforces pnpm ${packageJson.engines.pnpm}.`);
  }

  if (packageJson.bin.vdk !== './dist/cli.js') {
    passed = false;
    details.push('The published vdk bin entry must point to ./dist/cli.js.');
  } else {
    details.push('The published vdk bin entry points to ./dist/cli.js.');
  }

  const buildScript = packageJson.scripts.build;
  if (buildScript === undefined || !buildScript.includes('tsconfig.build.json')) {
    passed = false;
    details.push('Script "build" must compile the package with tsconfig.build.json.');
  } else {
    details.push('Script "build" compiles the package with tsconfig.build.json.');
  }

  const expectedScripts = new Map<string, string>([
    ['check-duplicates', 'src/validation/check-duplicates.ts'],
    ['health-check', 'src/utils/health-check.ts'],
    ['insights', 'src/utils/project-insights.ts'],
    ['lint:contracts', 'lint/blueprint-lint-trigger.ts'],
    ['validate', 'src/validation/validate-rules.ts'],
  ]);

  for (const [scriptName, requiredPath] of expectedScripts) {
    const scriptValue = packageJson.scripts[scriptName];

    if (scriptValue === undefined || !scriptValue.includes(requiredPath)) {
      passed = false;
      details.push(`Script "${scriptName}" must reference ${requiredPath}.`);
      continue;
    }

    details.push(`Script "${scriptName}" references ${requiredPath}.`);
  }

  return {
    details,
    name: 'Package metadata',
    passed,
  };
}

async function runEntryPointCheck(rootPath: string): Promise<HealthCheckItem> {
  const cliPath = path.join(rootPath, 'cli.ts');
  const cliContent = await readFile(cliPath, 'utf8');
  const firstLine = cliContent.split('\n')[0] ?? '';
  const passed = firstLine.startsWith('#!/usr/bin/env node');

  return {
    details: [
      passed
        ? 'cli.ts starts with a Node shebang.'
        : 'cli.ts must start with "#!/usr/bin/env node".',
    ],
    name: 'CLI entrypoint',
    passed,
  };
}

async function runRequiredSurfaceCheck(rootPath: string): Promise<HealthCheckItem> {
  const requiredPaths = getRequiredSurface(rootPath);
  const missingPaths: string[] = [];

  for (const requiredPath of requiredPaths) {
    if (!(await pathExists(requiredPath))) {
      missingPaths.push(requiredPath);
    }
  }

  return {
    details:
      missingPaths.length === 0
        ? ['All expected package files are present.']
        : missingPaths.map(filePath => `Missing required file: ${filePath}`),
    name: 'Package surface',
    passed: missingPaths.length === 0,
  };
}

async function runTemplateCheck(rootPath: string): Promise<HealthCheckItem> {
  const templatesDirectory = path.join(rootPath, 'src/templates');
  const templateFiles = await glob(['**/*.md', '**/*.mdc'], {
    absolute: true,
    cwd: templatesDirectory,
    onlyFiles: true,
  });

  return {
    details:
      templateFiles.length > 0
        ? [`Found ${templateFiles.length} template artifact file(s).`]
        : ['No template artifacts were found under src/templates.'],
    name: 'Template assets',
    passed: templateFiles.length > 0,
  };
}

export async function runHealthCheck(rootPath = DEFAULT_PROJECT_ROOT): Promise<HealthCheckReport> {
  const resolvedRootPath = path.resolve(rootPath);
  const checks = await Promise.all([
    runNodeVersionCheck(),
    runPackageMetadataCheck(resolvedRootPath),
    runEntryPointCheck(resolvedRootPath),
    runRequiredSurfaceCheck(resolvedRootPath),
    runTemplateCheck(resolvedRootPath),
  ]);

  return healthCheckReportSchema.parse({
    checks,
    passed: checks.every(check => check.passed),
    rootPath: resolvedRootPath,
  });
}

function renderHealthCheckReport(report: HealthCheckReport): void {
  writeStdout(chalk.blue.bold('VDK CLI health check'));
  writeStdout(chalk.dim(`Root path: ${report.rootPath}`));
  writeStdout('');

  for (const check of report.checks) {
    const statusLabel = check.passed ? chalk.green('PASS') : chalk.red('FAIL');
    writeStdout(`${statusLabel} ${check.name}`);

    for (const detail of check.details) {
      const writer = check.passed ? writeStdout : writeStderr;
      const coloredDetail = check.passed ? chalk.gray(detail) : chalk.red(detail);
      writer(`  ${coloredDetail}`);
    }

    writeStdout('');
  }

  if (report.passed) {
    writeStdout(chalk.green('All health checks passed.'));
    return;
  }

  writeStderr(chalk.red('One or more health checks failed.'));
}

async function runHealthCheckCli(options: HealthCheckCliOptions): Promise<number> {
  const report = await runHealthCheck(options.path);

  if (options.json) {
    writeStdout(JSON.stringify(report, null, 2));
  } else {
    renderHealthCheckReport(report);
  }

  return report.passed ? 0 : 1;
}

export async function runHealthCheckCliFromArgv(argv: string[] = process.argv): Promise<number> {
  const normalizedArgv = normalizeArgv(argv);
  const program = new Command()
    .name('health-check')
    .description('Validate the local VDK CLI package surface and metadata')
    .showHelpAfterError('(add --help for usage information)')
    .option('--json', 'Output the health report as JSON', false)
    .option('-p, --path <path>', 'Path to the VDK CLI package root', DEFAULT_PROJECT_ROOT)
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

  return await runHealthCheckCli(program.opts<HealthCheckCliOptions>());
}

if (isMainModule()) {
  runHealthCheckCliFromArgv().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      writeStderr(chalk.red(`Health check failed: ${formatError(error)}`));
      process.exitCode = 1;
    }
  );
}
