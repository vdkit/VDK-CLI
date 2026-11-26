#!/usr/bin/env node

/**
 * VDK CLI
 * -----------------------
 * main entry point for the VDK command-line interface.
 * Uses modular command architecture for better maintainability and testability.
 *
 * Repository: https://github.com/vdkit/VDK-CLI
 */

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { CommanderError } from 'commander';
import { z } from 'zod';

import { createCLIProgram } from './src/commands/index.js';
import { banner } from './src/utils/cli-styles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageInfoSchema = z.object({
  version: z.string().min(1),
});

type PackageInfo = z.infer<typeof packageInfoSchema>;
type ExitCodeError = Error & {
  exitCode?: number;
  logged?: boolean;
};

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

  return String(error);
}

function getExitCode(defaultCode = 0): number {
  return typeof process.exitCode === 'number' ? process.exitCode : defaultCode;
}

function isLoggedError(error: unknown): error is ExitCodeError {
  return error instanceof Error && 'logged' in error && error.logged === true;
}

async function resolvePackageRoot(): Promise<string> {
  const candidateRoots = [__dirname, path.resolve(__dirname, '..')];

  for (const candidateRoot of candidateRoots) {
    try {
      await access(path.join(candidateRoot, 'package.json'));
      return candidateRoot;
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to locate package.json from ${__dirname}`);
}

function loadEnvironment(packageRoot: string): void {
  dotenv.config({ path: path.join(packageRoot, '.env.local'), quiet: true });
  dotenv.config({ path: path.join(packageRoot, '.env'), quiet: true });
}

async function loadPackageInfo(packageRoot: string): Promise<PackageInfo> {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJsonContent = await readFile(packageJsonPath, 'utf8');
  return packageInfoSchema.parse(JSON.parse(packageJsonContent));
}

function installSignalHandlers(): () => void {
  const handleSignal = (signal: NodeJS.Signals): void => {
    writeStderr(`Received ${signal}. Shutting down.`);
    process.exitCode = 1;
    process.exit();
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  return () => {
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
  };
}

async function maybeHandleArchiveListing(cliArgs: string[]): Promise<boolean> {
  if (cliArgs[0] !== 'unzip' || cliArgs[1] !== '-l' || !cliArgs[2]) {
    return false;
  }

  try {
    const zipPath = cliArgs[2];
    const raw = await readFile(zipPath, 'utf8');

    let entries = [];
    try {
      const parsed = JSON.parse(raw);
      entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      entries = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    }

    writeStdout(`Archive: ${zipPath}`);
    for (const entry of entries) {
      writeStdout(entry);
    }
    return true;
  } catch (error) {
    writeStderr(formatError(error));
    process.exitCode = 1;
    return true;
  }
}

async function main(): Promise<number> {
  const packageRoot = await resolvePackageRoot();
  loadEnvironment(packageRoot);

  const cliArgs = process.argv.slice(2);
  if (await maybeHandleArchiveListing(cliArgs)) {
    return getExitCode();
  }

  const packageInfo = await loadPackageInfo(packageRoot);
  const program = createCLIProgram(packageInfo);
  program.exitOverride();

  if (cliArgs.length === 0) {
    writeStdout(banner());
    program.outputHelp();
    return 0;
  }

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      const code = error.code;
      if (code === 'commander.helpDisplayed' || code === 'commander.version') {
        return 0;
      }

      const misuseCodes = new Set([
        'commander.unknownOption',
        'commander.missingArgument',
        'commander.optionMissingArgument',
        'commander.excessArguments',
      ]);
      if (misuseCodes.has(code)) {
        writeStderr(error.message);
        process.exitCode = 2;
        return 2;
      }
    }

    if (error instanceof Error) {
      const exitCodeError: ExitCodeError = error;
      if (!isLoggedError(exitCodeError)) {
        writeStderr(formatError(error));
      }
      process.exitCode = typeof exitCodeError.exitCode === 'number' ? exitCodeError.exitCode : 1;
      return getExitCode(1);
    }

    writeStderr(formatError(error));
    process.exitCode = 1;
    return 1;
  }

  return getExitCode();
}

const removeSignalHandlers = installSignalHandlers();

main()
  .then(exitCode => {
    process.exitCode = exitCode;
  })
  .catch(error => {
    if (!isLoggedError(error)) {
      writeStderr(formatError(error));
    }
    process.exitCode = 1;
  })
  .finally(() => {
    removeSignalHandlers();
    process.exit(getExitCode());
  });
