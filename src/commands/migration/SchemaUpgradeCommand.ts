/**
 * SchemaUpgradeCommand
 * ====================
 * Upgrade blueprints from v2.x to AI Context Schema v3.0
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

type SchemaMigrationExecutionResult = {
  errors: number;
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
    options?: SchemaUpgradeCommandOptions
  ) => Promise<SchemaMigrationExecutionResult>;
};

type SchemaMigratorModule = {
  SchemaV3Migrator: new (options?: SchemaMigratorOptions) => SchemaMigrator;
};

type SchemaUpgradeCommandOptions = {
  dryRun?: boolean;
  force?: boolean;
  inPlace?: boolean;
  input?: string;
  output?: string;
  verbose?: boolean;
};

type SchemaUpgradePreviewResult = {
  alreadyV3: number;
  filesFound: number;
  mode: 'dry-run';
  needsUpgrade: number;
  success: true;
};

type SchemaUpgradeExecutionResult = SchemaMigrationExecutionResult & {
  mode: 'upgrade';
  success: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

export class SchemaUpgradeCommand extends BaseCommand {
  constructor() {
    super('schema-upgrade', 'Upgrade blueprints from v2.x to AI Context Schema v3.0');
  }

  configureOptions(command: Command): Command {
    return command
      .option('-i, --input <path>', 'Input directory containing blueprints', './blueprints')
      .option('-o, --output <path>', 'Output directory for v3.0 blueprints')
      .option('--force', 'Force upgrade even if already v3.0', false)
      .option('--dry-run', 'Preview upgrade without making changes', false)
      .option('--in-place', 'Upgrade files in-place (overwrites originals)', false)
      .option('-v, --verbose', 'Show detailed upgrade progress', false);
  }

  async execute(
    options: SchemaUpgradeCommandOptions
  ): Promise<SchemaUpgradeExecutionResult | SchemaUpgradePreviewResult> {
    await commandContext.initialize();
    this.showHeader();

    try {
      const inputPath = path.resolve(options.input ?? './blueprints');
      const outputPath = options.inPlace
        ? inputPath
        : options.output
          ? path.resolve(options.output)
          : `${inputPath}_v3`;
      const migrator = await loadSchemaMigrator({
        force: options.force,
        verbose: options.verbose,
      });

      if (options.dryRun) {
        this.logInfo('DRY RUN: No files will be modified');
        writeStdout('');
      }

      if (options.inPlace && !options.dryRun) {
        this.logWarning('IN-PLACE MODE: Original files will be overwritten');
        this.logInfo('Consider backing up your files first');
        writeStdout('');
      }

      writeStdout(`Input:  ${this.formatPath(inputPath)}`);
      writeStdout(`Output: ${this.formatPath(outputPath)}`);
      writeStdout('');

      if (options.dryRun) {
        return await this.performDryRun(migrator, inputPath);
      }

      return await this.performUpgrade(migrator, inputPath, outputPath, options);
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError(`Schema upgrade failed: ${commandError.message}`, commandError);
    }
  }

  async performDryRun(
    migrator: SchemaMigrator,
    inputPath: string
  ): Promise<SchemaUpgradePreviewResult> {
    const spinner = this.createSpinner('Analyzing blueprints for v3.0 upgrade...');
    spinner.start();

    try {
      const files = await migrator.findBlueprintFiles(inputPath);
      spinner.text = `Analyzing ${files.length} blueprint files...`;

      let needsUpgrade = 0;
      let alreadyV3 = 0;
      const filesToUpgrade: string[] = [];

      for (const filePath of files) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const parsed = matter(content);
          const frontmatter = isRecord(parsed.data) ? parsed.data : {};

          if (migrator.isV3Format(frontmatter)) {
            alreadyV3 += 1;
          } else {
            needsUpgrade += 1;
            filesToUpgrade.push(path.basename(filePath));
          }
        } catch {
          if (this.verbose) {
            this.logWarning(`Skipped problematic file: ${filePath}`);
          }
        }
      }

      spinner.succeed('Analysis complete');

      writeStdout('');
      writeStdout('Upgrade Preview:');
      writeStdout(`   Files found: ${files.length}`);
      writeStdout(`   Need upgrade: ${needsUpgrade}`);
      writeStdout(`   Already v3.0: ${alreadyV3}`);

      if (needsUpgrade > 0) {
        writeStdout('');
        writeStdout('Files to upgrade (showing first 10):');
        for (const fileName of filesToUpgrade.slice(0, 10)) {
          writeStdout(`   • ${fileName}`);
        }

        if (needsUpgrade > 10) {
          writeStdout(`   ... and ${needsUpgrade - 10} more`);
        }
      }

      return {
        alreadyV3,
        filesFound: files.length,
        mode: 'dry-run',
        needsUpgrade,
        success: true,
      };
    } catch (error) {
      spinner.fail('Analysis failed');
      throw error;
    }
  }

  async performUpgrade(
    migrator: SchemaMigrator,
    inputPath: string,
    outputPath: string,
    options: SchemaUpgradeCommandOptions
  ): Promise<SchemaUpgradeExecutionResult> {
    const spinner = this.createSpinner('Upgrading blueprints to v3.0...');
    spinner.start();

    try {
      const results = await migrator.migrateBlueprints(inputPath, outputPath, options);

      spinner.succeed(`Upgraded ${results.migrated} blueprint(s) to v3.0`);

      writeStdout('');
      writeStdout('Upgrade Summary:');
      writeStdout(`   Processed: ${results.processed}`);
      writeStdout(`   Upgraded: ${results.migrated}`);
      writeStdout(`   Skipped: ${results.skipped}`);

      if (results.errors > 0) {
        writeStdout(`   Errors: ${results.errors}`);
      }

      if (options.verbose && results.migrated > 0) {
        writeStdout('');
        writeStdout('Changes made:');
        writeStdout('   • Added schemaVersion: "3.0" to all files');
        writeStdout('   • Restructured platforms with components architecture');
        writeStdout('   • Added source tracking metadata');
        writeStdout('   • Migrated component manifests');
      }

      writeStdout('');
      writeStdout(`Output: ${this.formatPath(outputPath)}`);

      return {
        ...results,
        mode: 'upgrade',
        success: true,
      };
    } catch (error) {
      spinner.fail('Upgrade failed');
      throw error;
    }
  }
}

export default SchemaUpgradeCommand;
