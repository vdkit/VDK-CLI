/**
 * MCP Command
 * ===========
 * CLI command to manage MCP servers.
 */

import type { Command } from 'commander';

import { mcpManager } from '../../mcp/McpManager.js';
import { BaseCommand } from '../base/BaseCommand.js';

type McpServerConfig = {
  args?: string[];
  command: string;
  source: string;
};

type UpdateDetail = {
  path: string;
  success: boolean;
};

type UpdateProjectResult = {
  details?: UpdateDetail[];
  message?: string;
  success: boolean;
  updated?: number;
};

type UpdateConfigOptions = {
  force?: boolean;
  server?: string;
};

type ConfigureServerToolResult = {
  changed?: boolean;
  path?: string;
  reason?: string;
  success: boolean;
  tool: string;
};

type ConfigureServerResult = {
  configured?: number;
  message?: string;
  results?: ConfigureServerToolResult[];
  server?: string;
  success: boolean;
  total?: number;
};

type McpManager = {
  configureMCPServer: (
    projectPath: string,
    serverName: string,
    options: UpdateConfigOptions
  ) => Promise<unknown>;
  discover: () => Promise<unknown>;
  getServers: () => unknown;
  updateProjectConfig: (projectPath: string, options: UpdateConfigOptions) => Promise<unknown>;
};

const manager: McpManager = mcpManager;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'command' in value &&
    typeof value.command === 'string' &&
    'source' in value &&
    typeof value.source === 'string'
  );
}

function normalizeServers(value: unknown): Record<string, McpServerConfig> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const servers: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(value)) {
    if (isMcpServerConfig(config)) {
      servers[name] = config;
    }
  }

  return servers;
}

function normalizeUpdateResult(value: unknown): UpdateProjectResult {
  if (typeof value !== 'object' || value === null || !('success' in value)) {
    return {
      message: 'Invalid MCP update result',
      success: false,
      updated: 0,
    };
  }

  const success = value.success === true;
  const message =
    'message' in value && typeof value.message === 'string' ? value.message : undefined;
  const updated = 'updated' in value && typeof value.updated === 'number' ? value.updated : 0;
  const details =
    'details' in value && Array.isArray(value.details)
      ? value.details.filter(
          (detail): detail is UpdateDetail =>
            typeof detail === 'object' &&
            detail !== null &&
            'path' in detail &&
            typeof detail.path === 'string' &&
            'success' in detail &&
            typeof detail.success === 'boolean'
        )
      : undefined;

  return {
    details,
    message,
    success,
    updated,
  };
}

function normalizeConfigureResult(value: unknown): ConfigureServerResult {
  if (typeof value !== 'object' || value === null || !('success' in value)) {
    return { success: false, message: 'Invalid MCP configure result' };
  }

  const record = value as Record<string, unknown>;
  const results = Array.isArray(record.results)
    ? record.results.filter(
        (detail): detail is ConfigureServerToolResult =>
          typeof detail === 'object' &&
          detail !== null &&
          'tool' in detail &&
          typeof (detail as { tool: unknown }).tool === 'string' &&
          'success' in detail &&
          typeof (detail as { success: unknown }).success === 'boolean'
      )
    : undefined;

  return {
    configured: typeof record.configured === 'number' ? record.configured : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    results,
    server: typeof record.server === 'string' ? record.server : undefined,
    success: record.success === true,
    total: typeof record.total === 'number' ? record.total : undefined,
  };
}

export class McpCommand extends BaseCommand {
  constructor() {
    super('mcp', 'Manage Model Context Protocol servers');
  }

  configureOptions(command: Command): Command {
    command
      .command('list')
      .description('List discovered MCP servers')
      .action(() => this.listServers());

    command
      .command('update-config')
      .description('Update MCP configuration in rule files and per-tool MCP configs')
      .option('-f, --force', 'Force update even if no IDEs detected', false)
      .option(
        '-s, --server <name>',
        'Write a specific MCP server into each detected tool’s native config'
      )
      .action((options: UpdateConfigOptions) => this.updateConfig(options));

    return command;
  }

  async listServers(): Promise<void> {
    this.showHeader();

    await manager.discover();
    const servers = normalizeServers(manager.getServers());

    console.log('\nDiscovered MCP Servers:');
    if (Object.keys(servers).length === 0) {
      console.log('  (No servers found in standard locations)');
    } else {
      for (const [name, config] of Object.entries(servers)) {
        console.log(`  - ${name}`);
        console.log(`    Command: ${config.command} ${config.args?.join(' ') || ''}`);
        console.log(`    Source: ${config.source}`);
      }
    }
  }

  async updateConfig(options: UpdateConfigOptions): Promise<void> {
    this.showHeader();

    // When a specific server is named, write the real per-tool MCP configs.
    if (typeof options.server === 'string' && options.server.trim().length > 0) {
      await this.configureServer(options);
      return;
    }

    const spinner = this.createSpinner('Updating MCP configuration...');
    spinner.start();

    try {
      const result = normalizeUpdateResult(
        await manager.updateProjectConfig(process.cwd(), options)
      );

      if (result.success) {
        spinner.succeed(`Updated MCP configuration in ${result.updated ?? 0} directories`);
        if (result.details) {
          result.details.forEach(det => {
            if (det.success) this.logSuccess(`Updated ${det.path}`);
            else this.logError(`Failed to update ${det.path}`);
          });
        }
      } else {
        const failureMessage = result.message ?? 'MCP configuration update failed';
        spinner.fail(failureMessage);
        if (!options.force && failureMessage.includes('No IDE')) {
          this.logInfo('Tip: Use --force to create default configuration');
        }
      }
    } catch (error) {
      spinner.fail('Failed to update MCP configuration');
      this.logError(getErrorMessage(error));
    }
  }

  async configureServer(options: UpdateConfigOptions): Promise<void> {
    const serverName = (options.server ?? '').trim();
    const spinner = this.createSpinner(`Configuring MCP server '${serverName}' across tools...`);
    spinner.start();

    try {
      const result = normalizeConfigureResult(
        await manager.configureMCPServer(process.cwd(), serverName, options)
      );

      if (!result.success) {
        spinner.fail(result.message ?? `Failed to configure MCP server '${serverName}'`);
        if (result.results) {
          for (const tool of result.results) {
            this.logError(`✗ ${tool.tool}: ${tool.reason ?? 'failed'}`);
          }
        }
        return;
      }

      spinner.succeed(
        `Configured '${serverName}' in ${result.configured ?? 0}/${result.total ?? 0} tool config(s)`
      );

      for (const tool of result.results ?? []) {
        if (tool.success) {
          const state = tool.changed === false ? 'already up to date' : 'written';
          this.logSuccess(`✓ ${tool.tool} (${state}): ${tool.path ?? ''}`);
        } else {
          this.logError(`✗ ${tool.tool}: ${tool.reason ?? 'failed'}`);
        }
      }
    } catch (error) {
      spinner.fail('Failed to configure MCP server');
      this.logError(getErrorMessage(error));
    }
  }
}
