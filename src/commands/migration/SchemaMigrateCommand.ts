/**
 * SchemaMigrateCommand
 * -----------------------
 * Migrate existing blueprints to AI Context Schema v3.0 format.
 * Supports dry-run mode and comprehensive migration reporting.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';
import matter from 'gray-matter';

import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type SchemaMigratorOptions = {
  force?: boolean;
  verbose?: boolean;
};

type SchemaMigrationFileResult = {
  changes?: string[];
  error?: string;
  file: string;
  migrated: boolean;
  reason?: string;
};

type SchemaMigrationExecutionResult = {
  errors: number;
  files?: SchemaMigrationFileResult[];
  migrated: number;
  processed: number;
  skipped: number;
};

type SchemaMigrator = {
  findBlueprintFiles: (inputPath: string) => Promise<string[]>;
  isV3Format: (frontmatter: Record<string, unknown>) => boolean;
  migrateBlueprints: (
    inputPath: string,
    outputPath: string,
    options?: SchemaMigratorOptions
  ) => Promise<SchemaMigrationExecutionResult>;
};

type SchemaMigratorModule = {
  SchemaV3Migrator: new (options?: SchemaMigratorOptions) => SchemaMigrator;
};

type SchemaMigrateCommandOptions = {
  dryRun?: boolean;
  force?: boolean;
  input?: string;
  output?: string;
  verbose?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type SchemaMigrationPreviewResult = {
  alreadyMigrated: number;
  dryRun: true;
  filesFound: number;
  needsMigration: number;
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function loadSchemaMigrator(options: SchemaMigratorOptions): Promise<SchemaMigrator> {
  const migrationModule: SchemaMigratorModule =
    await import('../../migration/converters/schema-v3-migrator.js');

  return new migrationModule.SchemaV3Migrator(options);
}

export class SchemaMigrateCommand extends BaseCommand {
  constructor() {
    super('schema-migrate', 'Migrate existing blueprints to AI Context Schema v3.0 format');
  }

  configureOptions(command: Command): Command {
    return command
      .option(
        '-i, --input <path>',
        'Input directory containing blueprints',
        './.vdk/blueprints/rules'
      )
      .option('-o, --output <path>', 'Output directory for migrated blueprints')
      .option('--force', 'Force migration even if already in v3.0 format', false)
      .option('--dry-run', 'Preview migration without making changes', false)
      .option('-v, --verbose', 'Show detailed migration progress', false);
  }

  async execute(
    options: SchemaMigrateCommandOptions
  ): Promise<SchemaMigrationExecutionResult | SchemaMigrationPreviewResult> {
    await commandContext.initialize();
    this.showHeader();

    try {
      const inputPath = path.resolve(options.input ?? './.vdk/blueprints/rules');
      const outputPath = options.output ? path.resolve(options.output) : `${inputPath}_v3`;
      const migrator = await loadSchemaMigrator({
        force: options.force,
        verbose: options.verbose,
      });

      if (options.dryRun) {
        this.logInfo('DRY RUN: No files will be modified');
      }

      writeStdout(`Input:  ${this.formatPath(inputPath)}`);
      writeStdout(`Output: ${this.formatPath(outputPath)}`);

      if (options.dryRun) {
        return await this.performDryRun(migrator, inputPath);
      }

      return await this.performMigration(migrator, inputPath, outputPath, options);
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError(`Schema migration failed: ${commandError.message}`, commandError);
    }
  }

  async performDryRun(
    migrator: SchemaMigrator,
    inputPath: string
  ): Promise<SchemaMigrationPreviewResult> {
    const spinner = this.createSpinner('Analyzing blueprints for migration...');
    spinner.start();

    try {
      const files = await migrator.findBlueprintFiles(inputPath);
      spinner.text = `Analyzing ${files.length} blueprint files...`;

      let needsMigration = 0;
      let alreadyMigrated = 0;

      for (const filePath of files) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const parsed = matter(content);
          const frontmatter = isRecord(parsed.data) ? parsed.data : {};

          if (migrator.isV3Format(frontmatter)) {
            alreadyMigrated += 1;
          } else {
            needsMigration += 1;
          }
        } catch {
          if (this.verbose) {
            this.logWarning(`Skipped problematic file: ${filePath}`);
          }
        }
      }

      spinner.succeed('Analysis complete');

      writeStdout('');
      writeStdout('Migration Preview:');
      writeStdout(`- Files found: ${files.length}`);
      writeStdout(`- Need migration: ${needsMigration}`);
      writeStdout(`- Already migrated: ${alreadyMigrated}`);

      if (needsMigration > 0) {
        this.logInfo('Run without --dry-run to perform migration');
      } else {
        this.logSuccess('All blueprints are already in v3.0 format');
      }

      this.trackSuccess({
        alreadyMigrated,
        filesFound: files.length,
        mode: 'dry-run',
        needsMigration,
      });

      return {
        alreadyMigrated,
        dryRun: true,
        filesFound: files.length,
        needsMigration,
      };
    } catch (error) {
      spinner.fail('Analysis failed');
      throw error;
    }
  }

  async performMigration(
    migrator: SchemaMigrator,
    inputPath: string,
    outputPath: string,
    options: SchemaMigrateCommandOptions
  ): Promise<SchemaMigrationExecutionResult> {
    const spinner = this.createSpinner('Migrating blueprints...');
    spinner.start();

    try {
      const results = await migrator.migrateBlueprints(inputPath, outputPath, {
        force: options.force,
        verbose: options.verbose,
      });

      spinner.succeed('Migration complete');

      this.displayMigrationResults(results, outputPath, options.verbose === true);
      this.trackSuccess({
        errors: results.errors,
        migrated: results.migrated,
        mode: 'migration',
        processed: results.processed,
        skipped: results.skipped,
      });

      return results;
    } catch (error) {
      spinner.fail('Migration failed');
      throw error;
    }
  }

  displayMigrationResults(
    results: SchemaMigrationExecutionResult,
    outputPath: string,
    verbose: boolean
  ): void {
    writeStdout('');
    writeStdout('Results:');
    writeStdout(`- Processed: ${results.processed}`);
    writeStdout(`- Migrated: ${results.migrated}`);
    writeStdout(`- Skipped: ${results.skipped}`);
    writeStdout(`- Errors: ${results.errors}`);

    if (results.migrated > 0) {
      this.logSuccess(`${results.migrated} blueprints migrated to v3.0`);
      this.logInfo(
        `Run ${this.colorPrimary(`vdk validate --path ${outputPath}`)} to verify migrations`
      );
    }

    if (results.errors > 0) {
      this.logWarning(`${results.errors} files had errors during migration`);
      if (verbose && results.files) {
        const failedFiles = results.files.filter(
          (fileResult): fileResult is SchemaMigrationFileResult & { error: string } =>
            typeof fileResult.error === 'string'
        );

        for (const failedFile of failedFiles) {
          writeStdout(`  ✗ ${failedFile.file}: ${failedFile.error}`);
        }
      }
    }

    if (results.migrated === 0 && results.errors === 0) {
      this.logInfo('No blueprints required migration');
    }
  }
}
