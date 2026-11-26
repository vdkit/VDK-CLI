/**
 * StatusCommand
 * -----------------------
 * Handles 'vdk status' command - Check the status of VDK setup and Hub integration
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';

import { fetchRuleList } from '../../blueprints-client.js';
import { MigrationManager } from '../../migration/migration-manager.js';
import {
  displayDetailedHubStatus,
  displayTroubleshootingTips,
  formatHubStatusForTable,
  getHubStatus,
  type HubStatusDetails,
} from '../../shared/hub-status.js';
import { boxes, colors, format, status, tables } from '../../utils/cli-styles.js';
import { BaseCommand, type HubOperations } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type ScopeOption = 'all' | 'hub' | 'local';

type StatusCommandOptions = {
  configPath?: string;
  outputPath?: string;
  scope?: ScopeOption | string;
  verbose?: boolean;
};

type StatusCommandResult = {
  configured: boolean;
  hubConnected?: boolean;
};

type JsonObject = Record<string, unknown>;

type StatusTable = {
  push: (row: [string, string, string]) => number;
  toString: () => string;
};

type RemoteRule = {
  name: string;
};

type ProjectScanner = {
  scanProject: (projectPath: string) => Promise<object> | object;
};

type MigrationDetector = {
  detectAIContexts: (projectData: object) => Promise<unknown[]> | unknown[];
};

type DetectedIntegration = {
  confidence: 'high' | 'low' | 'medium' | string;
  name: string;
};

type IntegrationScanResults = {
  active: DetectedIntegration[];
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeScope(scope: ScopeOption | string | undefined): ScopeOption {
  return scope === 'hub' || scope === 'local' ? scope : 'all';
}

export class StatusCommand extends BaseCommand {
  constructor() {
    super('status', 'Check the status of your VDK setup and Hub integration');
  }

  configureOptions(command: Command): Command {
    return command
      .option('-c, --configPath <path>', 'Path to the VDK configuration file', './vdk.config.json')
      .option(
        '-o, --outputPath <path>',
        'Path to the rule artifacts directory',
        './.vdk/blueprints/rules'
      )
      .option('--scope <scope>', 'Status check scope (all, local, hub)', 'all')
      .option('-v, --verbose', 'Show detailed status information', false);
  }

  async execute(options: StatusCommandOptions): Promise<StatusCommandResult> {
    await commandContext.initialize();
    this.showHeader();

    const configPath = path.resolve(options.configPath ?? './vdk.config.json');
    const rulesDir = path.resolve(options.outputPath ?? './.vdk/blueprints/rules');
    const scope = normalizeScope(options.scope);

    if (scope === 'hub') {
      return this.executeHubOnlyStatus(options);
    }

    const spinner = this.createSpinner('Checking VDK status...');
    spinner.start();

    const statusTable: StatusTable = tables.status();
    let isConfigured = false;
    let hubStatus: HubStatusDetails | null = null;

    if (scope === 'all' || scope === 'local') {
      isConfigured = await this.checkVdkConfiguration(statusTable, configPath);
    }

    if (scope === 'all') {
      hubStatus = await this.checkHubAndBlueprints(statusTable, rulesDir);
    }

    if (scope === 'all' || scope === 'local') {
      await this.checkIdeIntegrations(statusTable);
    }

    spinner.stop();
    writeStdout(statusTable.toString());

    if (options.verbose && hubStatus) {
      writeStdout('');
      displayDetailedHubStatus(hubStatus, true);

      if (!hubStatus.connected) {
        displayTroubleshootingTips();
      }
    }

    if (!isConfigured) {
      this.showGettingStarted();
    }

    return { configured: isConfigured, hubConnected: hubStatus?.connected };
  }

  async executeHubOnlyStatus(options: StatusCommandOptions): Promise<StatusCommandResult> {
    try {
      const hubModule: {
        quickHubOperations: () => Promise<HubOperations>;
      } = await import('../../hub/index.js');
      const hubOps = await hubModule.quickHubOperations();

      const spinner = this.createSpinner('Testing Hub connection...');
      spinner.start();

      const hubStatus = await getHubStatus(hubOps);

      if (hubStatus.connected) {
        spinner.succeed('Connection test completed');
      } else {
        spinner.fail('Connection test failed');
      }

      displayDetailedHubStatus(hubStatus, options.verbose === true);

      if (!hubStatus.connected) {
        displayTroubleshootingTips();
      }

      this.trackSuccess({
        hubConnected: hubStatus.connected,
        verbose: options.verbose === true,
      });

      return {
        configured: true,
        hubConnected: hubStatus.connected,
      };
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError(`Hub status check failed: ${commandError.message}`, commandError);
    }
  }

  async checkVdkConfiguration(statusTable: StatusTable, configPath: string): Promise<boolean> {
    try {
      const config = await commandContext.readVdkConfig(process.cwd(), path.basename(configPath));
      if (config) {
        const project = isObject(config.project) ? config.project : null;
        const projectName = getString(project?.name) ?? 'Unknown';
        const ideName = getString(config.ide) ?? 'Unknown';

        statusTable.push([
          'VDK Configuration',
          status.success('Found'),
          `${format.keyValue('Project', projectName)}\n${format.keyValue('IDE', ideName)}`,
        ]);

        await this.checkMigrationOpportunities(statusTable);
        return true;
      }
    } catch {
      // Missing or invalid config is handled by the fallback row below.
    }

    statusTable.push([
      'VDK Configuration',
      status.warning('Missing'),
      `Run ${colors.primary('vdk init')} to get started`,
    ]);
    return false;
  }

  async checkMigrationOpportunities(statusTable: StatusTable): Promise<void> {
    try {
      const migrationManager = new MigrationManager({ projectPath: process.cwd() });
      const projectScanner: ProjectScanner = migrationManager.projectScanner;
      const migrationDetector: MigrationDetector = migrationManager.migrationDetector;
      const projectData = await Promise.resolve(projectScanner.scanProject(process.cwd()));
      if (!isObject(projectData)) {
        return;
      }

      const contexts = await Promise.resolve(migrationDetector.detectAIContexts(projectData));

      if (contexts.length > 0) {
        statusTable.push([
          'Existing AI Contexts',
          status.warning('Found'),
          `${format.count(contexts.length)} contexts available for migration\nRun ${colors.primary('vdk migrate')} to convert them`,
        ]);
      }
    } catch (error) {
      if (this.verbose) {
        writeStderr(`Migration detection error: ${getErrorMessage(error)}`);
      }
    }
  }

  async checkHubAndBlueprints(
    statusTable: StatusTable,
    rulesDir: string
  ): Promise<HubStatusDetails> {
    const hubStatus = await this.checkHubIntegration(statusTable);
    await this.checkBlueprintStatus(statusTable, rulesDir);
    return hubStatus;
  }

  async checkHubIntegration(statusTable: StatusTable): Promise<HubStatusDetails> {
    try {
      const hubStatus = await getHubStatus(this.hubOps);
      const [name, statusType, details] = formatHubStatusForTable(hubStatus);
      statusTable.push([name, status[statusType](statusType), details]);
      return hubStatus;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      statusTable.push(['VDK Hub Integration', status.error('Error'), errorMessage]);
      return { connected: false, available: false, error: errorMessage };
    }
  }

  async checkBlueprintStatus(statusTable: StatusTable, rulesDir: string): Promise<void> {
    try {
      await commandContext.ensureRulesDirectory(rulesDir);

      const localRules = await fs.readdir(rulesDir).catch((): string[] => []);
      statusTable.push([
        'Local Blueprints',
        status.success('Found'),
        `${format.count(localRules.length)} blueprints in ${format.path(rulesDir)}`,
      ]);

      const remoteRules: RemoteRule[] = await fetchRuleList();
      if (remoteRules.length > 0) {
        const remoteRuleNames = remoteRules.map(rule => rule.name);
        const newRules = remoteRuleNames.filter(ruleName => !localRules.includes(ruleName));

        if (newRules.length > 0) {
          statusTable.push([
            'VDK Repository',
            status.warning('Updates Available'),
            `${format.count(newRules.length)} new blueprints available\nRun ${colors.primary('vdk sync')} to update`,
          ]);
        } else {
          statusTable.push([
            'VDK Repository',
            status.success('Up to Date'),
            `${format.count(remoteRules.length)} total blueprints in sync`,
          ]);
        }
      } else {
        statusTable.push([
          'VDK Repository',
          status.error('Unreachable'),
          'Could not connect to VDK-Blueprints repository',
        ]);
      }
    } catch (error) {
      statusTable.push(['Blueprint Status', status.error('Error'), getErrorMessage(error)]);
    }
  }

  async checkIdeIntegrations(statusTable: StatusTable): Promise<void> {
    try {
      const integrationManager = await commandContext.createIntegrationManager();
      await integrationManager.discoverIntegrations({ verbose: false });

      const scanResults = await integrationManager.scanAll({
        verbose: false,
      });

      const activeIntegrations =
        isObject(scanResults) && Array.isArray(scanResults.active)
          ? scanResults.active
              .filter(
                (integration): integration is DetectedIntegration =>
                  isObject(integration) &&
                  typeof integration.name === 'string' &&
                  typeof integration.confidence === 'string'
              )
              .filter(
                integration =>
                  integration.confidence === 'high' || integration.confidence === 'medium'
              )
          : [];

      if (activeIntegrations.length > 0) {
        const ideList = activeIntegrations
          .map(integration => `${integration.name} (${integration.confidence} confidence)`)
          .join('\n');

        statusTable.push([
          'Detected IDEs/AI Tools',
          status.success('Found'),
          `${format.count(activeIntegrations.length)} active integrations:\n${ideList}`,
        ]);
      } else {
        statusTable.push([
          'Detected IDEs/AI Tools',
          status.warning('None'),
          'No AI assistants or IDEs detected\nUse generic rules for maximum compatibility',
        ]);
      }
    } catch (error) {
      if (process.env.VDK_DEBUG) {
        writeStderr(`IDE detection error: ${getErrorMessage(error)}`);
      }
      statusTable.push([
        'Detected IDEs/AI Tools',
        status.error('Error'),
        'Could not scan for IDE integrations',
      ]);
    }
  }

  showGettingStarted(): void {
    writeStdout(
      `\n${boxes.info(
        `Get started by running:\n${colors.primary('vdk init')}\n\nThis will scan your project and create project-aware AI blueprints.\n\nOther useful commands:\n${colors.primary('vdk sync')} - Sync blueprints from Hub and repository\n${colors.primary('vdk hub status')} - Check Hub integration\n${colors.primary('vdk migrate')} - Convert existing AI contexts`,
        'Quick Start'
      )}`
    );
  }
}
