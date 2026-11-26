/**
 * Plugin Command
 * ==============
 * CLI command to manage VDK plugins.
 */

import path from 'node:path';
import type { Command } from 'commander';

import { pluginRegistry } from '../../plugins/registry.js';
import { BaseCommand } from '../base/BaseCommand.js';

type InstalledPlugin = {
  description?: string;
  name: string;
  version: string;
};

type PluginRegistry = {
  loadFromDirectory: (directoryPath: string) => Promise<void>;
  plugins: Map<string, InstalledPlugin>;
};

const registry: PluginRegistry = pluginRegistry;

export class PluginCommand extends BaseCommand {
  constructor() {
    super('plugin', 'Manage VDK plugins');
  }

  configureOptions(command: Command): Command {
    const listCommand = command
      .command('list')
      .description('List installed plugins')
      .action(() => this.listPlugins());

    if (listCommand.parent !== null) {
      listCommand.parent
        .command('install <path>')
        .description('Install a plugin from a local path')
        .action((pluginPath: string) => this.installPlugin(pluginPath));
    }

    return command;
  }

  async listPlugins(): Promise<void> {
    this.showHeader();

    // For demo/prototype, load from a default directory
    const pluginDir = path.resolve(process.cwd(), '.vdk/plugins');
    await registry.loadFromDirectory(pluginDir);

    console.log('\nInstalled Plugins:');
    if (registry.plugins.size === 0) {
      console.log('  (No plugins installed)');
    } else {
      for (const [id, plugin] of registry.plugins) {
        console.log(`  - ${plugin.name} (${id}) v${plugin.version}`);
        console.log(`    ${plugin.description || ''}`);
      }
    }
  }

  async installPlugin(pluginPath: string): Promise<void> {
    this.showHeader();
    this.logInfo(`Installing plugin from ${pluginPath}...`);
    // Logic to copy plugin to .vdk/plugins would go here
    this.logSuccess('Plugin installed (Prototype)');
  }
}
