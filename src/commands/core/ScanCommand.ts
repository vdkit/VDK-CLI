/**
 * ScanCommand
 * -----------------------
 * Handles 'vdk scan' command - Re-analyze project and update existing AI rules
 * by rescanning the project and refreshing IDE integrations.
 */

import path from 'node:path';
import type { Command } from 'commander';

import {
  runScanner,
  type ScannerComponentResult,
  type ScannerOptions,
  type ScannerRunResult,
} from '../../scanner/index.js';
import { standardPatterns } from '../../utils/schema-validator.js';
import { BaseCommand, type ValidationRules } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type IdeOption = 'cursor' | 'jetbrains' | 'vscode' | string;
type RuleCategory = 'analysis' | 'deployment' | 'development' | 'testing' | 'workflow';

type ScanCommandOptions = {
  categories?: RuleCategory[];
  components?: boolean;
  deep?: boolean;
  force?: boolean;
  generateAgents?: boolean;
  ide?: IdeOption;
  ideIntegration?: boolean;
  ignorePattern?: string[];
  incremental?: boolean;
  outputPath?: string;
  projectPath?: string;
  useGitignore?: boolean;
  verbose?: boolean;
};

type JsonObject = Record<string, unknown>;

type ScanHistoryEntry = {
  filesUpdated: number;
  mode: string;
  targetIde?: string;
  timestamp: string;
};

type VdkConfig = JsonObject & {
  ide?: string;
  project?: JsonObject;
  scanHistory?: ScanHistoryEntry[];
};

type RuleGeneratorConstructor = new (
  outputPath: string,
  template: string,
  overwrite: boolean,
  options: {
    projectPath: string;
    verbose: boolean;
  }
) => {
  generateComponents: (
    results: ScannerRunResult,
    options: {
      generateAgents: boolean;
      overwrite: boolean;
    }
  ) => Promise<ScannerComponentResult>;
};

type ScanCommandResult = {
  configPath: string;
  results: ScannerRunResult;
  scanMode: 'full' | 'incremental';
  success: boolean;
};

const DEFAULT_IGNORE_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/build/**'];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export class ScanCommand extends BaseCommand {
  constructor() {
    super('scan', 'Re-analyze project and update existing AI rules');
  }

  configureOptions(command: Command): Command {
    return command
      .option('-p, --projectPath <path>', 'Path to the project to rescan', process.cwd())
      .option(
        '-o, --outputPath <path>',
        'Path where updated rule artifacts should be saved',
        './.vdk/blueprints/rules'
      )
      .option('--ide <ide>', 'Target specific IDE for scanning (vscode, jetbrains, cursor, etc.)')
      .option('-d, --deep', 'Enable deep scanning for more thorough pattern detection', false)
      .option(
        '-i, --ignorePattern <patterns...>',
        'Glob patterns to ignore',
        DEFAULT_IGNORE_PATTERNS
      )
      .option(
        '--use-gitignore',
        'Automatically parse .gitignore files for additional ignore patterns',
        true
      )
      .option('--incremental', 'Only scan changed files since last scan', false)
      .option('--force', 'Force full rescan even if no changes detected', false)
      .option('-v, --verbose', 'Enable verbose output for debugging', false)
      .option(
        '--categories <categories...>',
        'Specific command categories to update (e.g., development, testing, workflow)'
      )
      .option('--components', 'Regenerate platform-specific components', false)
      .option('--generate-agents', 'Regenerate agent components for supported platforms', false);
  }

  getValidationRules(): ValidationRules {
    const fields: NonNullable<ValidationRules['fields']> = {
      projectPath: {
        type: 'string',
        pathType: 'directory',
      },
      outputPath: {
        type: 'string',
        pathType: 'writeable',
      },
      verbose: {
        type: 'boolean',
      },
      ide: {
        type: 'string',
        enum: ['vscode', 'jetbrains', 'cursor', 'windsurf', 'zed', 'generic'],
        validate: (value: unknown) => {
          if (typeof value === 'string') {
            return value.toLowerCase() === value ? true : 'IDE name must be lowercase';
          }

          return true;
        },
      },
      categories: {
        type: 'array',
        validate: (categories: unknown) => {
          if (Array.isArray(categories)) {
            const validCategories: RuleCategory[] = [
              'development',
              'testing',
              'workflow',
              'deployment',
              'analysis',
            ];
            const invalidCategories = categories.filter(
              (category): category is string =>
                typeof category === 'string' && !validCategories.includes(category as RuleCategory)
            );

            if (invalidCategories.length > 0) {
              return `Invalid categories: ${invalidCategories.join(', ')}. Valid options: ${validCategories.join(', ')}`;
            }
          }

          return true;
        },
      },
      ignorePattern: {
        type: 'array',
      },
    };

    return {
      defaults: {
        projectPath: process.cwd(),
        outputPath: './.vdk/blueprints/rules',
        useGitignore: true,
        incremental: false,
        force: false,
        verbose: false,
        deep: false,
        ideIntegration: true,
      },
      fields,
      crossValidation: async (options: ScanCommandOptions) => {
        const errors: string[] = [];

        const vdkCheck = await standardPatterns.vdkInitializedValidation(options);
        if (vdkCheck !== true) {
          errors.push(vdkCheck);
        }

        if (options.incremental && options.force) {
          errors.push('Cannot use --incremental with --force (force implies full scan)');
        }

        return errors.length > 0 ? errors : true;
      },
    };
  }

  async execute(options: ScanCommandOptions): Promise<ScanCommandResult> {
    await commandContext.initialize();
    this.showHeader();

    await this.validateOptions(options, this.getValidationRules());

    const existingConfig = await this.loadVdkConfig(options.projectPath ?? process.cwd());
    const existingProject = isObject(existingConfig.project) ? existingConfig.project : null;
    this.logInfo(
      `Found existing VDK configuration for project: ${getString(existingProject?.name) ?? 'Unknown'}`
    );

    if (this.hubOps?.testConnection) {
      const connectivity = await this.hubOps.testConnection();
      if (connectivity.success) {
        this.logInfo('🌐 Connected to VDK Hub for new features');
      }
    } else {
      this.logWarning('⚠️  Hub integration unavailable, using local features');
    }

    const shouldRunIncremental =
      options.incremental === true &&
      options.force !== true &&
      (await this.canRunIncremental(options));
    const scanMode: 'full' | 'incremental' = shouldRunIncremental ? 'incremental' : 'full';

    const scannerOptions: ScannerOptions = {
      projectPath: options.projectPath ?? process.cwd(),
      outputPath: options.outputPath ?? './.vdk/blueprints/rules',
      deep: options.deep === true,
      ignorePattern: options.ignorePattern ?? [...DEFAULT_IGNORE_PATTERNS],
      useGitignore: options.useGitignore !== false,
      template: 'default',
      overwrite: true,
      verbose: options.verbose === true,
      ideIntegration: true,
      watch: false,
      categories: options.categories,
      components: options.components,
      generateAgents: options.generateAgents,
      ide: options.ide,
      existingConfig,
      force: options.force,
      incremental: shouldRunIncremental,
      mode: 'update',
      targetIde: options.ide,
    };

    const spinner = this.createSpinner(`Running ${scanMode} project scan and updating rules...`);
    spinner.start();

    try {
      const results = await runScanner(scannerOptions);
      spinner.succeed(
        `${scanMode === 'incremental' ? 'Incremental' : 'Full'} project scan completed successfully`
      );

      if (options.components || options.generateAgents) {
        await this.regenerateComponents(results, options);
      }

      const configPath = await this.updateVdkConfig(options, results, existingConfig, scanMode);
      this.logSuccess(`VDK configuration updated at ${this.formatPath(configPath)}`);

      this.showScanSummary(results, scanMode);

      this.trackSuccess({
        scanMode,
        blueprintsUpdated: results.generatedFiles.length,
        integrations: results.initializedIDEs,
        targetIde: options.ide,
        componentsRegenerated: results.componentsGenerated ?? 0,
      });

      return {
        success: true,
        scanMode,
        configPath,
        results,
      };
    } catch (error) {
      spinner.fail(`${scanMode} project scan failed`);
      throw error;
    }
  }

  async regenerateComponents(
    results: ScannerRunResult,
    options: ScanCommandOptions
  ): Promise<ScannerComponentResult> {
    const spinner = this.createSpinner('Regenerating platform-specific components...');
    spinner.start();

    try {
      const ruleGeneratorModule: { RuleGenerator: RuleGeneratorConstructor } =
        await import('../../scanner/core/RuleGenerator.js');
      const { RuleGenerator } = ruleGeneratorModule;

      const generator = new RuleGenerator(
        options.outputPath ?? './.vdk/blueprints/rules',
        'default',
        true,
        {
          verbose: options.verbose === true,
          projectPath: options.projectPath ?? process.cwd(),
        }
      );

      const componentResults = await generator.generateComponents(results, {
        generateAgents: options.generateAgents === true,
        overwrite: true,
      });

      spinner.succeed(
        `Regenerated ${componentResults.totalComponents} components across ${Object.keys(componentResults.platforms).length} platform(s)`
      );

      if (options.verbose) {
        this.logInfo('\n📦 Component Regeneration Summary:');
        for (const [platform, result] of Object.entries(componentResults.platforms)) {
          if (result.success) {
            this.logSuccess(`  ✓ ${platform}: ${result.componentCount} components`);
          } else {
            this.logError(`  ✗ ${platform}: ${result.errors.join(', ')}`);
          }
        }
      }

      results.componentsGenerated = componentResults.totalComponents;
      results.componentResults = componentResults;

      return componentResults;
    } catch (error) {
      spinner.fail('Component regeneration failed');
      throw error instanceof Error ? error : new Error(getErrorMessage(error));
    }
  }

  async loadVdkConfig(projectPath: string): Promise<VdkConfig> {
    try {
      const config = await commandContext.readVdkConfig(projectPath, 'vdk.config.json');

      if (!config) {
        throw new Error(
          `VDK configuration not found at ${path.join(projectPath, 'vdk.config.json')}`
        );
      }

      return config;
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError('Failed to load existing VDK configuration', commandError);
    }
  }

  async canRunIncremental(_options: ScanCommandOptions): Promise<boolean> {
    return false;
  }

  async updateVdkConfig(
    options: ScanCommandOptions,
    results: ScannerRunResult,
    existingConfig: VdkConfig,
    scanMode: 'full' | 'incremental'
  ): Promise<string> {
    const scanHistory = Array.isArray(existingConfig.scanHistory) ? existingConfig.scanHistory : [];

    const updatedConfig: VdkConfig = {
      ...existingConfig,
      lastScanned: new Date().toISOString(),
      scanHistory: [
        ...scanHistory.slice(-4),
        {
          timestamp: new Date().toISOString(),
          mode: scanMode,
          filesUpdated: results.generatedFiles.length,
          targetIde: options.ide,
        },
      ],
    };

    if (options.ide) {
      updatedConfig.ide = options.ide;
    }

    return commandContext.writeVdkConfig(updatedConfig, options.projectPath);
  }

  showScanSummary(results: ScannerRunResult, scanMode: 'full' | 'incremental'): void {
    writeStdout(`\n${this.colorPrimary('🔍 Scan Summary:')}`);
    writeStdout(this.formatKeyValue('Scan Mode', scanMode));
    writeStdout(
      this.formatKeyValue('Rules Updated', this.formatCount(results.generatedFiles.length))
    );

    if (results.initializedIDEs.length > 0) {
      writeStdout(
        this.formatKeyValue('IDE Integrations Updated', results.initializedIDEs.join(', '))
      );
    }

    if (results.componentsGenerated && results.componentsGenerated > 0) {
      writeStdout(
        this.formatKeyValue('Components Regenerated', this.formatCount(results.componentsGenerated))
      );
    }
  }
}
