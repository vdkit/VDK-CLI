/**
 * RepoStatsCommand
 * -----------------------
 * Show VDK-Blueprints repository statistics and canonical schema v3 compliance.
 * Provides comprehensive repository metrics and analysis.
 */

import type { Command } from 'commander';

import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type BlueprintStatistics = {
  authorDistribution?: Record<string, number>;
  averageSize?: number;
  byCategory: Record<string, number>;
  byComplexity: Record<string, number>;
  byMaturity: Record<string, number>;
  invalid: number;
  largestSize?: number;
  platformSupport: Record<string, number>;
  relationships: {
    withConflicts: number;
    withDependencies: number;
  };
  smallestSize?: number;
  tagsPopularity?: Record<string, number>;
  total: number;
  valid: number;
};

type GetBlueprintStatisticsModule = {
  getBlueprintStatistics: () => Promise<object>;
};

type RepoStatsCommandOptions = {
  verbose?: boolean;
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sortCountEntries(entries: Array<[string, number]>): Array<[string, number]> {
  return entries.toSorted(([, left], [, right]) => right - left);
}

function getCountRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, number>>((accumulator, [key, entryValue]) => {
    if (typeof entryValue === 'number') {
      accumulator[key] = entryValue;
    }

    return accumulator;
  }, {});
}

function normalizeBlueprintStatistics(value: unknown): BlueprintStatistics {
  if (!isRecord(value)) {
    return {
      byCategory: {},
      byComplexity: {},
      byMaturity: {},
      invalid: 0,
      platformSupport: {},
      relationships: {
        withConflicts: 0,
        withDependencies: 0,
      },
      total: 0,
      valid: 0,
    };
  }

  const relationships = isRecord(value.relationships) ? value.relationships : {};

  return {
    authorDistribution: getCountRecord(value.authorDistribution),
    averageSize: typeof value.averageSize === 'number' ? value.averageSize : undefined,
    byCategory: getCountRecord(value.byCategory),
    byComplexity: getCountRecord(value.byComplexity),
    byMaturity: getCountRecord(value.byMaturity),
    invalid: typeof value.invalid === 'number' ? value.invalid : 0,
    largestSize: typeof value.largestSize === 'number' ? value.largestSize : undefined,
    platformSupport: getCountRecord(value.platformSupport),
    relationships: {
      withConflicts:
        typeof relationships.withConflicts === 'number' ? relationships.withConflicts : 0,
      withDependencies:
        typeof relationships.withDependencies === 'number' ? relationships.withDependencies : 0,
    },
    smallestSize: typeof value.smallestSize === 'number' ? value.smallestSize : undefined,
    tagsPopularity: getCountRecord(value.tagsPopularity),
    total: typeof value.total === 'number' ? value.total : 0,
    valid: typeof value.valid === 'number' ? value.valid : 0,
  };
}

export class RepoStatsCommand extends BaseCommand {
  constructor() {
    super(
      'repo-stats',
      'Show VDK-Blueprints repository statistics and canonical schema v3 compliance'
    );
  }

  configureOptions(command: Command): Command {
    return command.option('-v, --verbose', 'Show detailed statistics', false);
  }

  async execute(options: RepoStatsCommandOptions): Promise<BlueprintStatistics> {
    await commandContext.initialize();
    this.showHeader();

    try {
      const statsModule: GetBlueprintStatisticsModule = await import('../../blueprints-client.js');
      const spinner = this.createSpinner('Analyzing repository statistics...');
      spinner.start();

      const rawStats = await statsModule.getBlueprintStatistics();
      const stats = normalizeBlueprintStatistics(rawStats);
      spinner.succeed('Statistics analysis completed');

      this.displayRepositoryStats(stats, options.verbose === true);

      this.trackSuccess({
        complianceRate: stats.total > 0 ? Math.round((stats.valid / stats.total) * 100) : 0,
        totalBlueprints: stats.total,
        validBlueprints: stats.valid,
      });

      return stats;
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(String(error));
      this.exitWithError(
        `Failed to fetch repository statistics: ${commandError.message}`,
        commandError
      );
    }
  }

  displayRepositoryStats(stats: BlueprintStatistics, verbose: boolean): void {
    const complianceRate = stats.total > 0 ? Math.round((stats.valid / stats.total) * 100) : 0;

    writeStdout('');
    writeStdout('Repository Overview:');
    writeStdout(`- Total Blueprints: ${stats.total}`);
    writeStdout(`- Schema v3 Valid: ${stats.valid} (${complianceRate}%)`);
    writeStdout(`- Invalid: ${stats.invalid}`);

    if (stats.total === 0) {
      writeStdout('');
      writeStdout('No blueprints available from the current source.');
      writeStdout('Check repository connectivity or configure a local blueprints source.');
      return;
    }

    if (Object.keys(stats.byCategory).length > 0) {
      writeStdout('');
      writeStdout('By Category:');
      for (const [category, count] of sortCountEntries(Object.entries(stats.byCategory))) {
        writeStdout(`- ${category}: ${count}`);
      }
    }

    if (Object.keys(stats.byComplexity).length > 0) {
      writeStdout('');
      writeStdout('By Complexity:');
      for (const [complexity, count] of sortCountEntries(Object.entries(stats.byComplexity))) {
        writeStdout(`- ${complexity}: ${count}`);
      }
    }

    if (Object.keys(stats.byMaturity).length > 0) {
      writeStdout('');
      writeStdout('By Maturity:');
      for (const [maturity, count] of sortCountEntries(Object.entries(stats.byMaturity))) {
        writeStdout(`- ${maturity}: ${count}`);
      }
    }

    writeStdout('');
    writeStdout('Relationships:');
    writeStdout(`- With Dependencies: ${stats.relationships.withDependencies}`);
    writeStdout(`- With Conflicts: ${stats.relationships.withConflicts}`);

    if (Object.keys(stats.platformSupport).length > 0) {
      const topCount = verbose ? 20 : 10;
      writeStdout('');
      writeStdout(`Platform Support (Top ${topCount}):`);
      for (const [platform, count] of sortCountEntries(Object.entries(stats.platformSupport)).slice(
        0,
        topCount
      )) {
        writeStdout(`- ${platform}: ${count}`);
      }
    }

    if (verbose) {
      this.displayVerboseStats(stats);
    }

    this.displayQualityInsights(stats);
  }

  displayVerboseStats(stats: BlueprintStatistics): void {
    writeStdout('');
    writeStdout(this.colorCyan('Detailed Analysis:'));

    if (stats.averageSize) {
      writeStdout('');
      writeStdout('Blueprint Sizes:');
      writeStdout(`- Average Size: ${Math.round(stats.averageSize)} bytes`);
      writeStdout(`- Largest: ${stats.largestSize ?? 0} bytes`);
      writeStdout(`- Smallest: ${stats.smallestSize ?? 0} bytes`);
    }

    if (stats.authorDistribution) {
      writeStdout('');
      writeStdout('Top Contributors:');
      for (const [author, count] of sortCountEntries(
        Object.entries(stats.authorDistribution)
      ).slice(0, 10)) {
        writeStdout(`- ${author}: ${count} blueprints`);
      }
    }

    if (stats.tagsPopularity) {
      writeStdout('');
      writeStdout('Popular Tags:');
      for (const [tag, count] of sortCountEntries(Object.entries(stats.tagsPopularity)).slice(
        0,
        15
      )) {
        writeStdout(`- ${tag}: ${count}`);
      }
    }
  }

  displayQualityInsights(stats: BlueprintStatistics): void {
    writeStdout('');
    writeStdout(this.colorCyan('Quality Insights:'));

    if (stats.total === 0) {
      this.logWarning('No blueprints were analyzed, so quality metrics are unavailable.');
      return;
    }

    const complianceRate = Math.round((stats.valid / stats.total) * 100);

    if (complianceRate >= 90) {
      this.logSuccess('Excellent schema compliance rate');
    } else if (complianceRate >= 75) {
      this.logInfo('Good schema compliance, some improvements possible');
    } else {
      this.logWarning('Schema compliance needs improvement');
    }

    const dependencyRate = Math.round((stats.relationships.withDependencies / stats.total) * 100);
    const conflictRate = Math.round((stats.relationships.withConflicts / stats.total) * 100);

    writeStdout('');
    writeStdout('Relationship Health:');
    writeStdout(`- ${dependencyRate}% of blueprints have dependencies`);
    writeStdout(`- ${conflictRate}% of blueprints have conflicts`);

    if (conflictRate > 10) {
      this.logWarning('High conflict rate may indicate overlapping functionality');
    }

    const platformCount = Object.keys(stats.platformSupport).length;
    writeStdout('');
    writeStdout(`Platform Coverage: ${platformCount} platforms supported`);

    if (platformCount < 5) {
      this.logInfo('Consider expanding platform support for broader compatibility');
    }
  }
}
