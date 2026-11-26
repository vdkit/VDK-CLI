/**
 * Team Config Command
 * ----------------
 * Sync VDK team configuration from shared resources (Git or Hub)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { z } from 'zod';

import { SyncOperations } from '../../shared/sync-operations.js';
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

type TeamConfigOptions = {
  backup?: boolean;
  dryRun?: boolean;
  force?: boolean;
  source?: 'auto' | 'git' | 'hub' | string;
  teamId?: string;
};

type SyncSource = 'git' | 'hub';

type SyncResult = {
  synced: number;
};

type TeamSyncResponse =
  | {
      backupCreated: boolean;
      source: SyncSource;
      success: boolean;
      synced: number;
    }
  | {
      error: string;
      success: false;
    };

type TeamSyncOperations = {
  createBackup: (targetPath: string, backupType: string) => Promise<string | null>;
  syncFromHub: (
    projectPath: string,
    options: {
      dryRun: boolean;
      force: boolean;
      teamId?: string;
      type: string;
    }
  ) => Promise<SyncResult>;
  syncFromRepository: (
    projectPath: string,
    options: {
      dryRun: boolean;
      force: boolean;
      type: string;
    }
  ) => Promise<SyncResult>;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class TeamConfigCommand extends BaseCommand {
  constructor() {
    super('team:config', 'Sync VDK team configuration from shared resources');
  }

  configureOptions(command: Command): Command {
    return command
      .option('--source <source>', 'Sync source (git|hub|auto)', 'auto')
      .option('--team-id <teamId>', 'Team ID for Hub sync')
      .option('--force', 'Force overwrite local configuration', false)
      .option('--dry-run', 'Show what would be synced without applying', false)
      .option('--backup', 'Backup existing configuration before sync', true);
  }

  async execute(options: TeamConfigOptions): Promise<TeamSyncResponse> {
    this.showHeader();

    const source = options.source ?? 'auto';
    const teamId = options.teamId;
    const force = options.force === true;
    const dryRun = options.dryRun === true;
    const backup = options.backup !== false;
    const syncOps: TeamSyncOperations = new SyncOperations(this);
    const projectPath = process.cwd();

    this.logInfo('🔄 VDK Team Config Sync');
    this.logInfo('');

    try {
      let actualSource = source;

      if (source === 'auto') {
        actualSource = await this.detectSource(projectPath);
        this.logInfo(`Auto-detected source: ${actualSource}`);
      }

      // Create backup if requested
      if (backup && !dryRun) {
        await syncOps.createBackup(path.join(projectPath, '.vdk'), 'team');
      }

      let result: SyncResult;
      if (actualSource === 'git') {
        result = await syncOps.syncFromRepository(projectPath, {
          force,
          dryRun,
          type: 'team-config',
        });
      } else if (actualSource === 'hub') {
        result = await syncOps.syncFromHub(projectPath, {
          teamId,
          force,
          dryRun,
          type: 'team-config',
        });
      } else {
        this.logError(`Unknown sync source: ${actualSource}`);
        return { success: false, error: 'Invalid sync source' };
      }

      if (result.synced > 0) {
        this.logSuccess('✅ Team configuration synced successfully');
        this.logInfo(`📁 ${result.synced} files updated`);
      } else {
        this.logWarning('⚠️  No changes applied');
      }

      return {
        success: true,
        source: actualSource,
        synced: result.synced,
        backupCreated: backup && !dryRun,
      };
    } catch (error) {
      const syncError = getErrorMessage(error);
      this.logError(`Team sync failed: ${syncError}`);
      return { success: false, error: syncError };
    }
  }

  async detectSource(projectPath: string): Promise<SyncSource> {
    // Check if we're in a Git repository with VDK files
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], {
        cwd: projectPath,
        stdio: 'ignore',
      });

      // Check if there are VDK files in Git
      const gitStatus = execFileSync('git', ['ls-files', '.vdk/'], {
        cwd: projectPath,
        encoding: 'utf8',
      });
      if (gitStatus.trim()) {
        return 'git';
      }
    } catch {
      // Not a Git repo or no VDK files in Git
    }

    // Check for Hub team configuration
    const configPath = path.join(projectPath, '.vdk', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = teamConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
        if (config.team?.id || process.env.VDK_TEAM_ID) {
          return 'hub';
        }
      } catch {
        // Invalid config file
      }
    }

    return 'git'; // Default fallback
  }
}
