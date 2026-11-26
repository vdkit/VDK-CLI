/**
 * Team Share Command
 * -----------------
 * Share project VDK configuration with team members via Git repository
 * or VDK Hub team features.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { Command } from 'commander';
import { z } from 'zod';

import { BaseCommand } from '../base/BaseCommand.js';

const teamConfigSchema = z
  .object({
    team: z
      .object({
        id: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

type TeamShareOptions = {
  dryRun?: boolean;
  includeLocal?: boolean;
  message?: string;
  method?: 'git' | 'hub' | string;
  teamId?: string;
};

type TeamShareContext = {
  projectPath: string;
};

type TeamShareResult = {
  commitMessage?: string;
  config?: SharedVdkConfig;
  dryRun?: boolean;
  error?: string;
  expiresAt?: string;
  files?: string[];
  filesShared?: string[];
  message?: string;
  method?: 'git' | 'hub';
  shareUrl?: string;
  success: boolean;
  teamId?: string;
};

type SharedVdkConfig = {
  blueprints?: Record<string, Record<string, string>>;
  main?: unknown;
};

type HubAuthStatus = {
  authenticated: boolean;
};

type TeamShareResponse = {
  expiresAt?: string;
  shareUrl: string;
};

type HubClient = {
  checkAuth: () => Promise<HubAuthStatus>;
  shareTeamConfig: (teamId: string, config: SharedVdkConfig) => Promise<TeamShareResponse>;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class TeamShareCommand extends BaseCommand {
  constructor() {
    super('team:share', 'Share VDK configuration with team members');
  }

  configureOptions(command: Command): Command {
    return command
      .description('Share VDK configuration with team members')
      .option('--method <method>', 'Sharing method (git|hub)', 'git')
      .option('--team-id <teamId>', 'Team ID for Hub sharing')
      .option('--include-local', 'Include local settings (use with caution)', false)
      .option('--dry-run', 'Show what would be shared without actually sharing', false)
      .option(
        '--message <message>',
        'Commit message for git sharing',
        'chore: share VDK team configuration'
      );
  }

  async execute(options: TeamShareOptions): Promise<TeamShareResult> {
    const method = options.method ?? 'git';
    const context: TeamShareContext = {
      projectPath: process.cwd(),
    };

    this.showHeader();
    this.logInfo('🤝 VDK Team Share');
    this.logInfo('');

    try {
      // Check if VDK is initialized
      const vdkConfigPath = path.join(context.projectPath, '.vdk');
      if (!fs.existsSync(vdkConfigPath)) {
        this.logError('VDK not initialized in this project');
        this.logInfo('Run `vdk init` first to create VDK configuration');
        return { success: false, error: 'VDK not initialized' };
      }

      if (method === 'git') {
        return await this.shareViaGit(options, context);
      } else if (method === 'hub') {
        return await this.shareViaHub(options, context);
      } else {
        this.logError(`Unknown sharing method: ${method}`);
        return { success: false, error: 'Invalid sharing method' };
      }
    } catch (error) {
      const shareError = getErrorMessage(error);
      this.logError(`Team share failed: ${shareError}`);
      return { success: false, error: shareError };
    }
  }

  async shareViaGit(
    options: TeamShareOptions,
    context: TeamShareContext
  ): Promise<TeamShareResult> {
    const includeLocal = options.includeLocal === true;
    const dryRun = options.dryRun === true;
    const message = options.message ?? 'chore: share VDK team configuration';
    const { projectPath } = context;

    this.logInfo('📦 Sharing via Git repository...');

    try {
      try {
        execFileSync('git', ['rev-parse', '--git-dir'], { cwd: projectPath, stdio: 'ignore' });
      } catch {
        this.logError('This project is not a Git repository');
        this.logInfo('Initialize Git first: git init');
        return { success: false, error: 'Not a Git repository' };
      }

      // Prepare files to share
      const filesToShare = ['.vdk/blueprints/', '.vdk/config.json'];

      if (includeLocal) {
        this.logWarning('⚠️  Including local settings - ensure no sensitive data is shared');
        filesToShare.push('.vdk/settings.local.json');
      }

      // Check what files exist
      const existingFiles: string[] = [];
      for (const file of filesToShare) {
        const fullPath = path.join(projectPath, file);
        if (fs.existsSync(fullPath)) {
          existingFiles.push(file);
        }
      }

      if (existingFiles.length === 0) {
        this.logWarning('No VDK configuration files found to share');
        return { success: false, error: 'No files to share' };
      }

      if (dryRun) {
        this.logInfo('📋 Dry run - would share these files:');
        existingFiles.forEach(file => {
          this.logInfo(`  • ${file}`);
        });
        return { success: true, dryRun: true, files: existingFiles };
      }

      // Add files to Git
      for (const file of existingFiles) {
        execFileSync('git', ['add', '--', file], { cwd: projectPath, stdio: 'inherit' });
      }

      // Commit the changes
      execFileSync('git', ['commit', '-m', message], { cwd: projectPath, stdio: 'inherit' });

      this.logSuccess('✅ VDK configuration committed to Git');
      this.logInfo('');
      this.logInfo('Next steps:');
      this.logInfo('1. Push changes: git push');
      this.logInfo('2. Team members can pull and run: vdk team:config');

      return {
        success: true,
        method: 'git',
        filesShared: existingFiles,
        commitMessage: message,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('nothing to commit')) {
        this.logInfo('No changes to commit - VDK configuration already shared');
        return { success: true, message: 'Already up to date' };
      }
      throw error;
    }
  }

  async shareViaHub(
    options: TeamShareOptions,
    context: TeamShareContext
  ): Promise<TeamShareResult> {
    const teamId = options.teamId;
    const dryRun = options.dryRun === true;
    const { projectPath } = context;

    this.logInfo('☁️  Sharing via VDK Hub...');

    if (!teamId) {
      this.logError('Team ID required for Hub sharing');
      this.logInfo('Use --team-id <id> or set VDK_TEAM_ID environment variable');
      return { success: false, error: 'Team ID required' };
    }

    try {
      const { VDKHubClient } = await import('../../hub/VDKHubClient.js');
      const hubClient: HubClient = new VDKHubClient();

      // Check authentication
      const authStatus = await hubClient.checkAuth();
      if (!authStatus.authenticated) {
        this.logError('VDK Hub authentication required');
        this.logInfo('Run `vdk hub auth` to authenticate');
        return { success: false, error: 'Authentication required' };
      }

      // Read VDK configuration
      const vdkConfig = this.readVDKConfig(projectPath);

      if (dryRun) {
        this.logInfo('📋 Dry run - would share:');
        this.logInfo(`  • Team ID: ${teamId}`);
        this.logInfo(`  • Configuration files: ${Object.keys(vdkConfig).length}`);
        return { success: true, dryRun: true, config: vdkConfig };
      }

      // Share configuration with team
      const shareResult = await hubClient.shareTeamConfig(teamId, vdkConfig);

      this.logSuccess('✅ VDK configuration shared with team');
      this.logInfo(`Share URL: ${shareResult.shareUrl}`);
      this.logInfo('');
      this.logInfo(`Team members can sync with: vdk team:config --source hub --team-id ${teamId}`);

      return {
        success: true,
        method: 'hub',
        teamId,
        shareUrl: shareResult.shareUrl,
        expiresAt: shareResult.expiresAt,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Team not found')) {
        this.logError('Team not found - check team ID or create team first');
      }
      throw error;
    }
  }

  readVDKConfig(projectPath: string): SharedVdkConfig {
    const config: SharedVdkConfig = {};
    const vdkPath = path.join(projectPath, '.vdk');

    // Read main config
    const configFile = path.join(vdkPath, 'config.json');
    if (fs.existsSync(configFile)) {
      config.main = teamConfigSchema.parse(JSON.parse(fs.readFileSync(configFile, 'utf8')));
    }

    // Read blueprint artifacts by kind
    const artifactsRoot = path.join(vdkPath, 'blueprints');
    if (fs.existsSync(artifactsRoot)) {
      config.blueprints = {};

      const collectFilesRecursively = (baseDir: string): string[] => {
        const files: string[] = [];
        const entries = fs.readdirSync(baseDir, { withFileTypes: true }) as Dirent[];

        for (const entry of entries) {
          const fullPath = path.join(baseDir, entry.name);

          if (entry.isDirectory()) {
            files.push(...collectFilesRecursively(fullPath));
            continue;
          }

          files.push(fullPath);
        }

        return files;
      };

      const kindEntries = fs.readdirSync(artifactsRoot, { withFileTypes: true }) as Dirent[];
      for (const kindEntry of kindEntries) {
        if (!kindEntry.isDirectory()) {
          continue;
        }

        const kind = kindEntry.name;
        const kindPath = path.join(artifactsRoot, kind);
        const artifactFiles = collectFilesRecursively(kindPath);

        if (artifactFiles.length === 0) {
          continue;
        }

        config.blueprints[kind] = {};
        for (const artifactFile of artifactFiles) {
          const relativeArtifactPath = path.relative(kindPath, artifactFile);
          const content = fs.readFileSync(artifactFile, 'utf8');
          config.blueprints[kind][relativeArtifactPath] = content;
        }
      }
    }

    return config;
  }
}
