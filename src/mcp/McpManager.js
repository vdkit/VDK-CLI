/**
 * MCP Manager
 * ===========
 * Manages Model Context Protocol (MCP) server configurations and discovery.
 * Supports standard MCP config locations (Clause, VS Code, etc.).
 */

import { existsSync, writeFileSync } from 'node:fs'; // Sync for operations where shared libs might expect sync, or refactor to async
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getMCPConfigPaths, updateMCPConfigurationFile } from '../shared/editor-path-resolver.js';
import * as ideConfig from '../shared/ide-configuration.js';

// Per-tool MCP config targets. Each entry defines the IDE id (resolved against
// ide-configuration.js for its mcpConfigFile path) and the JSON key under which
// MCP servers are stored in that tool's distinct config schema. An explicit
// projectFile overrides the ide-configuration path where the tool does not
// declare an mcpConfigFile (e.g. Claude Code uses a project-root .mcp.json).
const MCP_CONFIG_TARGETS = [
  {
    ideId: 'claude-code-cli',
    label: 'Claude (project .mcp.json)',
    serversKey: 'mcpServers',
    projectFile: '.mcp.json',
  },
  { ideId: 'claude-desktop', label: 'Claude Desktop', serversKey: 'mcpServers' },
  { ideId: 'windsurf', label: 'Windsurf', serversKey: 'mcpServers' },
  { ideId: 'cursor', label: 'Cursor', serversKey: 'mcpServers' },
  { ideId: 'vscode', label: 'VS Code', serversKey: 'servers' },
];

export class McpManager {
  constructor() {
    this.configs = new Map();
  }

  /**
   * Discover MCP configurations in standard locations
   */
  async discover() {
    const locations = [
      path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json'),
      path.join(os.homedir(), '.config/Claude/claude_desktop_config.json'), // Linux
      path.join(os.homedir(), 'AppData/Roaming/Claude/claude_desktop_config.json'), // Windows
      // Add other IDE locations if known
    ];

    for (const loc of locations) {
      try {
        const content = await fs.readFile(loc, 'utf8');
        const config = JSON.parse(content);
        if (config.mcpServers) {
          this.configs.set(loc, config.mcpServers);
        }
      } catch {
        // Ignore missing files
      }
    }

    return this.configs;
  }

  /**
   * Get combined list of known MCP servers
   */
  getServers() {
    const servers = {};
    for (const [source, serverMap] of this.configs) {
      for (const [name, config] of Object.entries(serverMap)) {
        servers[name] = { ...config, source };
      }
    }
    return servers;
  }
  /**
   * Update MCP configuration in project
   */
  async updateProjectConfig(projectPath, options = {}) {
    const force = options.force;

    // Detect IDEs
    const detectedIDEs = ideConfig.detectIDEs(projectPath);

    if (detectedIDEs.length === 0 && !force) {
      return { success: false, message: 'No IDE configurations detected (use force to override)' };
    }

    // Find rule directories
    const ruleDirectories = [];

    // Check detected IDEs
    detectedIDEs.forEach(ide => {
      const rulePath = path.join(projectPath, ide.rulesFolder);
      if (existsSync(rulePath)) {
        ruleDirectories.push({ path: rulePath, source: ide.name });
      }
    });

    // Check common paths if none found
    if (ruleDirectories.length === 0) {
      const commonPaths = [
        '.vdk/blueprints/rules',
        '.vscode/ai-rules',
        '.cursor/rules',
        '.claude/rules',
        '.windsurf/rules',
        '.zed/ai-rules',
        '.idea/ai-rules',
      ];

      for (const rulePath of commonPaths) {
        const fullPath = path.join(projectPath, rulePath);
        if (existsSync(fullPath)) {
          ruleDirectories.push({ path: fullPath, source: 'Common Path' });
        }
      }
    }

    // Create default if forced
    if (ruleDirectories.length === 0 && force) {
      const defaultPath = path.join(projectPath, '.vdk/blueprints/rules');
      if (!existsSync(defaultPath)) {
        await fs.mkdir(defaultPath, { recursive: true });
      }
      ruleDirectories.push({ path: defaultPath, source: 'Default' });
    }

    if (ruleDirectories.length === 0) {
      return { success: false, message: 'No rule directories found' };
    }

    // Update configs
    let successCount = 0;
    const results = [];

    for (const ruleDir of ruleDirectories) {
      // Ensure file exists
      const mcpFilePath = path.join(ruleDir.path, '03-mcp-configuration.mdc');
      if (!existsSync(mcpFilePath)) {
        this.createDefaultMcpFile(mcpFilePath);
      }

      // Update file
      const success = updateMCPConfigurationFile(projectPath, ruleDir.path);
      results.push({ path: ruleDir.path, success });
      if (success) successCount++;
    }

    return {
      success: successCount > 0,
      updated: successCount,
      total: ruleDirectories.length,
      details: results,
    };
  }

  /**
   * Configure a single MCP server across all detected tools by writing each
   * tool's native MCP JSON config (Claude .mcp.json, Windsurf mcp_config.json,
   * VS Code mcp.json, etc.). Merges idempotently — re-running does not create
   * duplicate entries. Also refreshes the .mdc documentation rule.
   *
   * @param {string} projectPath - Project root
   * @param {string} serverName - Name of the MCP server to configure
   * @param {Object} [options] - { definition, force }
   * @returns {Promise<Object>} Per-tool results
   */
  async configureMCPServer(projectPath, serverName, options = {}) {
    if (!serverName || typeof serverName !== 'string') {
      return { success: false, message: 'A server name is required (--server <name>)' };
    }

    // Resolve the server definition: explicit option, then discovered servers.
    let definition = options.definition;
    if (!definition) {
      await this.discover();
      const servers = this.getServers();
      definition = servers[serverName];
    }

    if (!definition) {
      return {
        success: false,
        message:
          `MCP server '${serverName}' not found in discovered configurations. ` +
          `Provide its definition or run 'vdk mcp list' to see available servers.`,
        results: [],
      };
    }

    // Normalize to the canonical server entry shape used in MCP configs.
    const serverEntry = this.normalizeServerEntry(definition);

    const detectedIDEs = ideConfig.detectIDEs(projectPath);
    const detectedIds = new Set(detectedIDEs.map(ide => ide.id));

    const results = [];

    for (const target of MCP_CONFIG_TARGETS) {
      // Only write configs for tools that are actually detected, unless forced.
      if (!options.force && !detectedIds.has(target.ideId)) {
        continue;
      }

      const configFilePath = this.resolveTargetConfigPath(target, projectPath);
      if (!configFilePath) {
        results.push({
          tool: target.label,
          success: false,
          reason: 'No MCP config path available for this tool',
        });
        continue;
      }

      try {
        const written = await this.mergeServerIntoConfig(
          configFilePath,
          target.serversKey,
          serverName,
          serverEntry
        );
        results.push({
          tool: target.label,
          path: configFilePath,
          success: true,
          changed: written.changed,
        });
      } catch (error) {
        results.push({
          tool: target.label,
          path: configFilePath,
          success: false,
          reason: error.message,
        });
      }
    }

    // Keep the human-readable .mdc documentation up to date alongside the real
    // config writes (documentation is secondary to the actual config effect).
    try {
      await this.updateProjectConfig(projectPath, { force: options.force });
    } catch {
      // Documentation refresh is best-effort; real config writes already done.
    }

    const successCount = results.filter(r => r.success).length;

    return {
      success: successCount > 0,
      server: serverName,
      configured: successCount,
      total: results.length,
      results,
    };
  }

  /**
   * Resolve the concrete config file path for a tool target.
   * @param {Object} target - MCP_CONFIG_TARGETS entry
   * @param {string} projectPath
   * @returns {string|null}
   */
  resolveTargetConfigPath(target, projectPath) {
    if (target.projectFile) {
      return path.join(projectPath, target.projectFile);
    }

    const ide = ideConfig.IDE_CONFIGURATIONS?.find?.(entry => entry.id === target.ideId);

    // A tool's declared mcpConfigFile may itself be a home-relative path (e.g.
    // Windsurf's ~/.codeium/windsurf/mcp_config.json). Expand those rather than
    // joining under the project root.
    if (ide?.mcpConfigFile && ide.mcpConfigFile.startsWith('~')) {
      return path.join(os.homedir(), ide.mcpConfigFile.slice(1));
    }

    const paths = getMCPConfigPaths(target.ideId, projectPath);
    return paths.projectConfig || paths.globalConfig || null;
  }

  /**
   * Normalize a server definition into the canonical MCP server entry,
   * stripping internal bookkeeping fields like `source`.
   * @param {Object} definition
   * @returns {Object}
   */
  normalizeServerEntry(definition) {
    const { source: _source, ...rest } = definition;
    const entry = {};

    if (rest.command) entry.command = rest.command;
    if (Array.isArray(rest.args)) entry.args = rest.args;
    if (rest.env && typeof rest.env === 'object') entry.env = rest.env;
    if (rest.url) entry.url = rest.url;
    if (rest.type) entry.type = rest.type;

    // Preserve any additional known transport fields.
    for (const key of ['cwd', 'headers', 'timeout']) {
      if (rest[key] !== undefined) entry[key] = rest[key];
    }

    return entry;
  }

  /**
   * Idempotently merge a server entry into a tool's MCP JSON config file,
   * creating the file/directory if needed.
   * @param {string} configFilePath
   * @param {string} serversKey - 'mcpServers' or 'servers'
   * @param {string} serverName
   * @param {Object} serverEntry
   * @returns {Promise<{ changed: boolean }>}
   */
  async mergeServerIntoConfig(configFilePath, serversKey, serverName, serverEntry) {
    let config = {};

    try {
      const existing = await fs.readFile(configFilePath, 'utf8');
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === 'object') {
        config = parsed;
      }
    } catch {
      // File missing or invalid JSON — start fresh.
    }

    if (!config[serversKey] || typeof config[serversKey] !== 'object') {
      config[serversKey] = {};
    }

    const previous = config[serversKey][serverName];
    const serialized = JSON.stringify(serverEntry);
    const changed = JSON.stringify(previous) !== serialized;

    // Idempotent: only the named server entry is replaced; others are preserved.
    config[serversKey][serverName] = serverEntry;

    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.writeFile(configFilePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    return { changed };
  }

  createDefaultMcpFile(filePath) {
    const content = `---
description: Defines the available Model Context Protocol (MCP) servers and their capabilities.
globs:
alwaysApply: false
version: "2.1.0"
lastUpdated: "${new Date().toISOString().split('T')[0]}"
compatibleWith: ["Memory-MCP", "Sequential-Thinking-Advanced", "MCP-Integration"]
---
# MCP Server Configuration

This file documents the Model Context Protocol (MCP) servers available in your environment.
`;
    writeFileSync(filePath, content, 'utf8');
  }
}

export const mcpManager = new McpManager();
