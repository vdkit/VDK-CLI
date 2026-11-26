/**
 * PlatformCommand
 * -----------------------
 * List blueprints compatible with specific platform.
 * Shows platform-specific configuration and compatibility details.
 */

import type { Command } from 'commander';

import { tables } from '../../utils/cli-styles.js';
import { BaseCommand, type CommandOptions } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type PlatformConfiguration = {
  characterLimit?: number;
  command?: boolean;
  contextAware?: boolean;
  fileExtensions?: string[];
  globs?: string[];
  memory?: unknown;
  priority?: number | string;
};

type PlatformBlueprint = {
  category?: string;
  name?: string;
  platformConfig?: PlatformConfiguration;
  title?: string;
};

type GetBlueprintsForPlatformModule = {
  getBlueprintsForPlatform: (platform: string) => Promise<PlatformBlueprint[]>;
};

type PlatformCommandOptions = CommandOptions & {
  args?: unknown[];
  limit?: string;
  verbose?: boolean;
};

type BasicTable = {
  push: (row: string[]) => number;
  toString: () => string;
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function parseLimit(limitValue: string | undefined, fallback = 20): number {
  const parsed = Number.parseInt(limitValue ?? String(fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export class PlatformCommand extends BaseCommand {
  constructor() {
    super('platform', 'List blueprints compatible with specific platform');
  }

  configureOptions(command: Command): Command {
    return command
      .argument(
        '<platform>',
        'Platform identifier (claude-code, cursor, windsurf, zed, vscode, etc.)'
      )
      .option('--limit <number>', 'Limit number of results', '20')
      .option('-v, --verbose', 'Show detailed platform configuration', false);
  }

  async execute(options: PlatformCommandOptions): Promise<{
    blueprints: PlatformBlueprint[];
    total: number;
  }> {
    await commandContext.initialize();

    const platformArgument = options.args?.[0];
    const platform = typeof platformArgument === 'string' ? platformArgument : '';

    if (!platform) {
      this.exitWithError('Platform argument is required. Use --help for usage information');
    }

    this.showHeader(`Blueprints for ${platform}`);

    try {
      const platformModule: GetBlueprintsForPlatformModule =
        await import('../../blueprints-client.js');
      const spinner = this.createSpinner(`Finding blueprints for ${platform}...`);
      spinner.start();

      const blueprints = await platformModule.getBlueprintsForPlatform(platform);
      const limit = parseLimit(options.limit);
      const limitedBlueprints = blueprints.slice(0, limit);

      spinner.succeed(`Found ${blueprints.length} compatible blueprints`);

      if (limitedBlueprints.length === 0) {
        this.logWarning(`No blueprints found compatible with ${platform}`);
        this.displaySuggestedPlatforms();
        return { blueprints: [], total: 0 };
      }

      this.displayPlatformBlueprints(limitedBlueprints, options.verbose === true);
      this.displayResultsSummary(blueprints.length, limit);

      this.trackSuccess({
        displayed: limitedBlueprints.length,
        platform,
        totalFound: blueprints.length,
      });

      return { blueprints: limitedBlueprints, total: blueprints.length };
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(String(error));
      this.exitWithError(`Platform query failed: ${commandError.message}`, commandError);
    }
  }

  displayPlatformBlueprints(blueprints: PlatformBlueprint[], verbose: boolean): void {
    const platformTable: BasicTable = tables.basic();

    platformTable.push([
      this.colorPrimary('Name'),
      this.colorPrimary('Title'),
      this.colorPrimary('Category'),
      this.colorPrimary('Platform Config'),
    ]);

    for (const blueprint of blueprints) {
      const config = blueprint.platformConfig ?? {};
      platformTable.push([
        blueprint.name ?? 'Unknown',
        (blueprint.title ?? blueprint.name ?? 'Untitled').substring(0, 30),
        blueprint.category ?? 'Unknown',
        this.buildConfigSummary(config),
      ]);
    }

    writeStdout(platformTable.toString());

    if (verbose) {
      this.displayVerboseConfigDetails(blueprints);
    }
  }

  buildConfigSummary(config: PlatformConfiguration): string {
    let configSummary = 'Basic';

    if (config.globs) configSummary += ', Globs';
    if (config.characterLimit) configSummary += ', CharLimit';
    if (config.priority) configSummary += `, P${config.priority}`;
    if (config.memory) configSummary += ', Memory';
    if (config.command) configSummary += ', Commands';
    if (config.fileExtensions) configSummary += ', FileExt';
    if (config.contextAware) configSummary += ', Context';

    return configSummary;
  }

  displayVerboseConfigDetails(blueprints: PlatformBlueprint[]): void {
    writeStdout('');
    writeStdout(this.colorCyan('Platform Configuration Details:'));

    for (const [index, blueprint] of blueprints.slice(0, 5).entries()) {
      const config = blueprint.platformConfig ?? {};

      writeStdout('');
      writeStdout(`${index + 1}. ${blueprint.title ?? blueprint.name ?? 'Untitled'}`);

      if (config.characterLimit) {
        writeStdout(`   Character Limit: ${config.characterLimit}`);
      }

      if (config.priority) {
        writeStdout(`   Priority: ${config.priority}`);
      }

      if (config.globs && config.globs.length > 0) {
        writeStdout(`   File Globs: ${config.globs.join(', ')}`);
      }

      if (config.fileExtensions && config.fileExtensions.length > 0) {
        writeStdout(`   File Extensions: ${config.fileExtensions.join(', ')}`);
      }

      if (config.memory) {
        writeStdout(`   Memory Settings: ${JSON.stringify(config.memory)}`);
      }

      if (config.contextAware) {
        writeStdout(`   Context Aware: ${String(config.contextAware)}`);
      }
    }

    if (blueprints.length > 5) {
      writeStdout('');
      writeStdout(`... and ${blueprints.length - 5} more blueprints`);
    }
  }

  displayResultsSummary(totalFound: number, limit: number): void {
    const summary = totalFound > limit ? ` (showing ${limit})` : '';

    writeStdout('');
    writeStdout(`Found ${totalFound} compatible blueprints${summary}`);

    if (totalFound > limit) {
      writeStdout(this.colorCyan(`Use --limit ${totalFound} to see all results`));
    }
  }

  displaySuggestedPlatforms(): void {
    writeStdout('');
    writeStdout(this.colorCyan('Available Platforms:'));
    writeStdout('• claude-code    - Claude Code IDE integration');
    writeStdout('• cursor         - Cursor AI editor');
    writeStdout('• windsurf       - Windsurf AI assistant');
    writeStdout('• zed            - Zed editor');
    writeStdout('• vscode         - Visual Studio Code');
    writeStdout('• github-copilot - GitHub Copilot');
    writeStdout('• jetbrains      - JetBrains IDEs');
    writeStdout('• vim            - Vim/Neovim');
    writeStdout('');
    writeStdout(this.colorCyan('Use: vdk platform <platform-name>'));
  }
}
