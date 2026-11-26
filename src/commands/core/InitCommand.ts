/**
 * InitCommand
 * -----------------------
 * Handles 'vdk init' command - Initialize VDK and generate project-aware AI rules
 * by scanning the project and setting up IDE integrations.
 */

import type { Command } from 'commander';

import {
  runScanner,
  type ScannerComponentResult,
  type ScannerOptions,
  type ScannerRunResult,
  type WatchableIdeIntegration,
} from '../../scanner/index.js';
import { BaseCommand, type ValidationRules } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type IdeOption = 'cursor' | 'generic' | 'intellij' | 'jetbrains' | 'vscode' | 'windsurf' | 'zed';
type PresetOption = 'auto' | 'development' | 'full' | 'minimal' | 'production';
type TemplateOption = 'comprehensive' | 'default' | 'minimal';
type RuleCategory = 'analysis' | 'deployment' | 'development' | 'testing' | 'workflow';

type InitCommandOptions = {
  categories?: RuleCategory[];
  components?: boolean;
  deep?: boolean;
  dryRun?: boolean;
  generateAgents?: boolean;
  ide?: IdeOption;
  ideIntegration?: boolean;
  ignorePattern?: string[];
  interactive?: boolean;
  outputPath?: string;
  overwrite?: boolean;
  preset?: PresetOption;
  projectPath?: string;
  template?: TemplateOption;
  useGitignore?: boolean;
  verbose?: boolean;
  watch?: boolean;
};

type VdkConfig = {
  ide: string;
  lastUpdated: string;
  project: {
    name: string;
  };
  rulesPath: string;
};

type WatchPromiseHandlers = {
  reject: (reason?: unknown) => void;
  resolve: () => void;
};

type ClosableWatcher = {
  close: () => Promise<void> | void;
};

type WatchResources = {
  ideIntegration: WatchableIdeIntegration | null;
  intervals: Set<NodeJS.Timeout>;
  isShuttingDown: boolean;
  promise?: WatchPromiseHandlers;
  timers: Set<NodeJS.Timeout>;
  watchers: Set<ClosableWatcher>;
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

type InitCommandResult = {
  configPath: string;
  results: ScannerRunResult;
  success: boolean;
};

const DEFAULT_IGNORE_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/build/**'];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRuleCategory(value: string): value is RuleCategory {
  return (
    value === 'analysis' ||
    value === 'deployment' ||
    value === 'development' ||
    value === 'testing' ||
    value === 'workflow'
  );
}

export class InitCommand extends BaseCommand {
  private watchResources: WatchResources | null = null;

  constructor() {
    super('init', 'Initialize VDK and generate project-aware AI rules by scanning the project');
  }

  configureOptions(command: Command): Command {
    return command
      .option('-p, --projectPath <path>', 'Path to the project to scan', process.cwd())
      .option(
        '-o, --outputPath <path>',
        'Path where generated rule artifacts should be saved',
        './.vdk/blueprints/rules'
      )
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
      .option('-t, --template <name>', 'Name of the rule template to use', 'default')
      .option(
        '--ide <ide>',
        'Target specific IDE (vscode, intellij, jetbrains, cursor, zed, windsurf)'
      )
      .option('--overwrite', 'Overwrite existing rule files without prompting', false)
      .option('--ide-integration', 'Enable IDE integration setup', true)
      .option('--no-ide-integration', 'Disable IDE integration setup')
      .option('--watch', 'Enable watch mode for continuous IDE integration updates', false)
      .option('-v, --verbose', 'Enable verbose output for debugging', false)
      .option(
        '--categories <categories...>',
        'Specific command categories to fetch (e.g., development, testing, workflow)'
      )
      .option(
        '--preset <preset>',
        'Preset command collection (minimal, full, development, production)',
        'auto'
      )
      .option('--interactive', 'Enable interactive category selection', false)
      .option(
        '--components',
        'Generate platform-specific components (agents, commands, etc.)',
        false
      )
      .option('--generate-agents', 'Generate agent components for supported platforms', false);
  }

  getValidationRules(): ValidationRules {
    return {
      defaults: {
        projectPath: process.cwd(),
        outputPath: './.vdk/blueprints/rules',
        template: 'default',
        useGitignore: true,
        ideIntegration: true,
        preset: 'auto',
        overwrite: false,
        deep: false,
        watch: false,
        verbose: false,
        interactive: false,
      },
      fields: {
        projectPath: {
          type: 'string',
          pathType: 'directory',
        },
        outputPath: {
          type: 'string',
          pathType: 'writeable',
        },
        template: {
          type: 'string',
          enum: ['default', 'minimal', 'comprehensive'],
        },
        ide: {
          type: 'string',
          enum: ['vscode', 'intellij', 'jetbrains', 'cursor', 'zed', 'windsurf', 'generic'],
          validate: (value: unknown) => {
            if (typeof value === 'string') {
              return value.toLowerCase() === value ? true : 'IDE name must be lowercase';
            }

            return true;
          },
        },
        preset: {
          type: 'string',
          enum: ['auto', 'minimal', 'full', 'development', 'production'],
        },
        ignorePattern: {
          type: 'array',
          warn: (patterns: unknown) => {
            if (Array.isArray(patterns) && patterns.length > 10) {
              return 'Large number of ignore patterns may impact performance';
            }

            return true;
          },
        },
        categories: {
          type: 'array',
          validate: (categories: unknown) => {
            if (Array.isArray(categories)) {
              const invalidCategories = categories.filter(
                (category): category is string =>
                  typeof category === 'string' && !isRuleCategory(category)
              );

              if (invalidCategories.length > 0) {
                const validCategories: RuleCategory[] = [
                  'development',
                  'testing',
                  'workflow',
                  'deployment',
                  'analysis',
                ];
                return `Invalid categories: ${invalidCategories.join(', ')}. Valid options: ${validCategories.join(', ')}`;
              }
            }

            return true;
          },
        },
      },
      crossValidation: (options: InitCommandOptions) => {
        const errors: string[] = [];

        if (options.watch && options.dryRun) {
          errors.push('Cannot use --watch with --dry-run');
        }

        if (options.interactive && options.categories) {
          errors.push('Cannot specify --categories when using --interactive mode');
        }

        if (options.watch && !options.ideIntegration) {
          errors.push('Watch mode requires IDE integration to be enabled');
        }

        return errors.length > 0 ? errors : true;
      },
    };
  }

  async execute(options: InitCommandOptions): Promise<InitCommandResult> {
    await commandContext.initialize();
    this.showHeader();

    await this.validateOptions(options, this.getValidationRules());

    if (this.hubOps?.testConnection) {
      const connectivity = await this.hubOps.testConnection();
      if (connectivity.success) {
        this.logInfo('🌐 Connected to VDK Hub for new features');
      }
    } else {
      this.logWarning('⚠️  Hub integration unavailable, using local features');
    }

    const spinner = this.createSpinner('Scanning project and generating rules...');
    spinner.start();

    try {
      const scannerOptions: ScannerOptions = {
        projectPath: options.projectPath ?? process.cwd(),
        outputPath: options.outputPath ?? './.vdk/blueprints/rules',
        deep: options.deep === true,
        ignorePattern: options.ignorePattern ?? [...DEFAULT_IGNORE_PATTERNS],
        useGitignore: options.useGitignore !== false,
        template: options.template ?? 'default',
        overwrite: options.overwrite === true,
        verbose: options.verbose === true,
        ideIntegration: options.ideIntegration !== false,
        watch: options.watch === true,
        categories: options.categories,
        components: options.components,
        generateAgents: options.generateAgents,
        ide: options.ide,
        interactive: options.interactive,
        preset: options.preset,
      };

      const results = await runScanner(scannerOptions);
      spinner.succeed('Project scan completed successfully');

      if (options.components || options.generateAgents) {
        await this.generateComponents(results, options);
      }

      const configPath = await this.createVdkConfig(options, results);
      this.logSuccess(`VDK configuration created at ${this.formatPath(configPath)}`);

      this.trackSuccess({
        blueprintsGenerated: results.generatedFiles.length,
        integrations: results.initializedIDEs,
        componentsGenerated: results.componentsGenerated ?? 0,
      });

      if (options.watch && results.ideIntegration) {
        this.logInfo('Watch mode enabled. Press Ctrl+C to exit.');
        await this.setupWatchMode(results.ideIntegration);
      }

      return {
        success: true,
        configPath,
        results,
      };
    } catch (error) {
      spinner.fail('Project scan failed');
      throw error;
    }
  }

  async generateComponents(
    results: ScannerRunResult,
    options: InitCommandOptions
  ): Promise<ScannerComponentResult> {
    const spinner = this.createSpinner('Generating platform-specific components...');
    spinner.start();

    try {
      const ruleGeneratorModule: { RuleGenerator: RuleGeneratorConstructor } =
        await import('../../scanner/core/RuleGenerator.js');
      const { RuleGenerator } = ruleGeneratorModule;

      const generator = new RuleGenerator(
        options.outputPath ?? './.vdk/blueprints/rules',
        options.template ?? 'default',
        options.overwrite === true,
        {
          verbose: options.verbose === true,
          projectPath: options.projectPath ?? process.cwd(),
        }
      );

      const componentResults = await generator.generateComponents(results, {
        generateAgents: options.generateAgents === true,
        overwrite: options.overwrite === true,
      });

      spinner.succeed(
        `Generated ${componentResults.totalComponents} components across ${Object.keys(componentResults.platforms).length} platform(s)`
      );

      if (options.verbose) {
        this.logInfo('\n📦 Component Generation Summary:');
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
      spinner.fail('Component generation failed');
      throw error instanceof Error ? error : new Error(getErrorMessage(error));
    }
  }

  async createVdkConfig(options: InitCommandOptions, results: ScannerRunResult): Promise<string> {
    const config: VdkConfig = {
      project: {
        name: results.projectName,
      },
      ide: results.detectedPrimaryIDE ?? results.initializedIDEs[0] ?? 'generic',
      rulesPath: options.outputPath ?? './.vdk/blueprints/rules',
      lastUpdated: new Date().toISOString(),
    };

    return commandContext.writeVdkConfig(config, options.projectPath);
  }

  setupWatchMode(ideIntegration: WatchableIdeIntegration): Promise<void> {
    this.watchResources = {
      ideIntegration,
      timers: new Set<NodeJS.Timeout>(),
      watchers: new Set<ClosableWatcher>(),
      intervals: new Set<NodeJS.Timeout>(),
      isShuttingDown: false,
    };

    const signalHandler = (signal: NodeJS.Signals): void => {
      if (!this.watchResources) {
        process.exit(1);
      }

      if (this.watchResources.isShuttingDown) {
        this.logWarning('Forcefully shutting down...');
        process.exit(1);
      }

      this.logInfo(`Received ${signal}, shutting down watch mode...`);
      this.cleanupWatchMode()
        .then(() => {
          process.exit(0);
        })
        .catch((error: unknown) => {
          this.logError(`Cleanup failed: ${getErrorMessage(error)}`);
          process.exit(1);
        });
    };

    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);
    process.on('SIGQUIT', signalHandler);

    process.on('uncaughtException', (error: Error) => {
      this.logError(`Uncaught exception in watch mode: ${error.message}`);
      void this.cleanupWatchMode().finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason: unknown) => {
      this.logError(`Unhandled rejection in watch mode: ${getErrorMessage(reason)}`);
      void this.cleanupWatchMode().finally(() => process.exit(1));
    });

    const healthCheckInterval = setInterval(() => {
      try {
        this.watchResources?.ideIntegration?.healthCheck?.();
      } catch (error) {
        this.logWarning(`IDE integration health check failed: ${getErrorMessage(error)}`);
      }
    }, 30_000);

    this.watchResources.intervals.add(healthCheckInterval);

    return new Promise<void>((resolve, reject) => {
      if (!this.watchResources) {
        reject(new Error('Watch mode resources were not initialized'));
        return;
      }

      this.watchResources.promise = { resolve, reject };

      const timeout = setTimeout(
        () => {
          this.logInfo('Watch mode timeout reached (24 hours), shutting down...');
          void this.cleanupWatchMode().then(resolve).catch(reject);
        },
        24 * 60 * 60 * 1000
      );

      this.watchResources.timers.add(timeout);
    });
  }

  async cleanupWatchMode(): Promise<void> {
    if (!this.watchResources || this.watchResources.isShuttingDown) {
      return;
    }

    this.watchResources.isShuttingDown = true;

    try {
      for (const timer of this.watchResources.timers) {
        clearTimeout(timer);
      }
      this.watchResources.timers.clear();

      for (const interval of this.watchResources.intervals) {
        clearInterval(interval);
      }
      this.watchResources.intervals.clear();

      for (const watcher of this.watchResources.watchers) {
        await watcher.close();
      }
      this.watchResources.watchers.clear();

      if (this.watchResources.ideIntegration?.shutdown) {
        try {
          await this.watchResources.ideIntegration.shutdown();
        } catch (error) {
          this.logWarning(`IDE integration shutdown error: ${getErrorMessage(error)}`);
        }
      }

      this.watchResources.promise?.resolve();
      this.logInfo('Watch mode cleanup completed');
    } catch (error) {
      this.logError(`Error during watch mode cleanup: ${getErrorMessage(error)}`);
      throw error;
    }
  }
}
