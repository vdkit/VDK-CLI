/**
 * SyncCommand
 * -----------------------
 * Handles 'vdk sync' command - Sync blueprints from VDK Hub and repository
 */

import type { Command } from 'commander';

import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type SyncResult = {
  error?: string;
  status?: string;
  synced: number;
};

type SyncOperations = {
  syncFromHub: (
    targetDir: string,
    options: { category?: string; force?: boolean; type: 'blueprints' }
  ) => Promise<SyncResult>;
  syncFromRepository: (
    targetDir: string,
    options: { category?: string; force?: boolean; type: 'blueprints' }
  ) => Promise<SyncResult>;
};

type SyncOperationsModule = {
  SyncOperations: new (command: BaseCommand) => SyncOperations;
};

type SyncCommandOptions = {
  category?: string;
  force?: boolean;
  hubOnly?: boolean;
  outputPath?: string;
  repoOnly?: boolean;
};

export class SyncCommand extends BaseCommand {
  constructor() {
    super('sync', 'Sync blueprints from VDK Hub and repository');
  }

  configureOptions(command: Command): Command {
    return command
      .option(
        '-o, --outputPath <path>',
        'Path to the blueprints artifact root directory',
        './.vdk/blueprints'
      )
      .option('--force', 'Force full sync instead of incremental', false)
      .option('--category <category>', 'Sync specific category only')
      .option('--hub-only', 'Sync only from Hub, not repository', false)
      .option('--repo-only', 'Sync only from repository, not Hub', false);
  }

  async execute(options: SyncCommandOptions): Promise<{
    errors: string[];
    hubSynced: number;
    repoSynced: number;
    success: boolean;
    totalSynced: number;
  }> {
    await commandContext.initialize();
    this.showHeader();

    const artifactsRoot = await commandContext.ensureRulesDirectory(
      options.outputPath ?? './.vdk/blueprints'
    );
    const syncOperationsModule: SyncOperationsModule =
      await import('../../shared/sync-operations.js');
    const syncOps = new syncOperationsModule.SyncOperations(this);

    let totalSynced = 0;
    let hubSynced = 0;
    let repoSynced = 0;
    const errors: string[] = [];
    // Track whether any source actually completed successfully (ok or empty) so
    // that an errored sync is never silently reported as "up to date".
    let anySourceAttempted = false;
    let anySourceErrored = false;

    if (this.hubOps && !options.repoOnly) {
      anySourceAttempted = true;
      const hubResult = await syncOps.syncFromHub(artifactsRoot, {
        category: options.category,
        force: options.force,
        type: 'blueprints',
      });
      hubSynced = hubResult.synced;
      totalSynced += hubSynced;
      if (hubResult.status === 'error') {
        anySourceErrored = true;
        errors.push(`Hub: ${hubResult.error ?? 'sync failed'}`);
      }
    }

    if (!options.hubOnly) {
      anySourceAttempted = true;
      const repoResult = await syncOps.syncFromRepository(artifactsRoot, {
        category: options.category,
        force: options.force,
        type: 'blueprints',
      });
      repoSynced = repoResult.synced;
      totalSynced += repoSynced;
      if (repoResult.status === 'error') {
        anySourceErrored = true;
        errors.push(`Repository: ${repoResult.error ?? 'sync failed'}`);
      }
    }

    const success = anySourceAttempted && !anySourceErrored;

    if (success) {
      this.trackSuccess({
        blueprintsGenerated: totalSynced,
        metadata: {
          force: options.force === true,
          hub_synced: hubSynced,
          repo_synced: repoSynced,
        },
      });
    }

    this.showSyncResults(totalSynced, hubSynced, repoSynced, errors);

    return {
      errors,
      hubSynced,
      repoSynced,
      success,
      totalSynced,
    };
  }

  showSyncResults(
    totalSynced: number,
    hubSynced: number,
    repoSynced: number,
    errors: string[]
  ): void {
    // An errored sync is NEVER reported as up-to-date.
    if (errors.length > 0) {
      this.logError('Sync completed with errors:');
      for (const error of errors) {
        this.logError(`  ${error}`);
      }

      if (totalSynced > 0) {
        this.logInfo(`Partially synced ${totalSynced} blueprint(s) from healthy sources`);
      } else {
        this.logWarning('No blueprints were synced. Existing local blueprints are unchanged.');
      }
      return;
    }

    if (totalSynced > 0) {
      this.logSuccess(`Total: ${totalSynced} blueprints synced`);

      if (hubSynced > 0) {
        this.logInfo(`Hub: ${hubSynced} blueprints`);
      }
      if (repoSynced > 0) {
        this.logInfo(`Repository: ${repoSynced} blueprints`);
      }
      return;
    }

    // No errors and zero newly-synced: genuinely up to date (or empty catalog).
    this.logSuccess('All blueprints are up to date');
  }
}
