/**
 * BrowseCommand
 * -----------------------
 * Handles 'vdk browse' command - Browse and discover community blueprints
 */

import type { Command } from 'commander';

import { colors } from '../../utils/cli-styles.js';
import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type PlatformCompatibility = {
  enabled?: boolean;
};

type RepositoryBlueprintMetadata = {
  category?: string;
  complexity?: string;
  description?: string;
  id?: string;
  platforms?: Record<string, PlatformCompatibility>;
  title?: string;
};

type RepositoryBlueprint = {
  metadata?: RepositoryBlueprintMetadata;
  retrieval?: {
    canonicalKind?: string;
    specificityLayer?: string;
  };
};

type CommunityBlueprint = {
  author?: string;
  description?: string;
  id: string;
  rating?: number | string;
  title?: string;
  usageCount?: number;
};

type CommunityBlueprintResponse = {
  blueprints?: CommunityBlueprint[];
};

type SearchBlueprintsCriteria = {
  category?: string;
  framework?: string;
  includeL4?: boolean;
  kind?: string;
  limit?: number;
  platform?: string;
  specificity?: string;
};

type SearchBlueprintsModule = {
  searchBlueprints: (criteria: SearchBlueprintsCriteria) => Promise<RepositoryBlueprint[]>;
};

type HubClient = {
  searchCommunityBlueprints: (criteria: {
    category?: string;
    framework?: string;
    limit?: number;
    platform?: string;
  }) => Promise<CommunityBlueprintResponse>;
};

type HubClientModule = {
  VDKHubClient: new () => HubClient;
};

type BrowseCommandOptions = {
  category?: string;
  community?: boolean;
  framework?: string;
  includeL4?: boolean;
  kind?: string;
  limit?: string;
  platform?: string;
  source?: string;
  specificity?: string;
  trending?: boolean;
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLimit(limitValue: string | undefined, fallback = 20): number {
  const parsed = Number.parseInt(limitValue ?? String(fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeCommunityBlueprintResponse(value: unknown): CommunityBlueprintResponse {
  if (!isRecord(value) || !Array.isArray(value.blueprints)) {
    return { blueprints: [] };
  }

  return {
    blueprints: value.blueprints
      .filter(isRecord)
      .map(entry => ({
        author: typeof entry.author === 'string' ? entry.author : undefined,
        description: typeof entry.description === 'string' ? entry.description : undefined,
        id: typeof entry.id === 'string' ? entry.id : '',
        rating:
          typeof entry.rating === 'number' || typeof entry.rating === 'string'
            ? entry.rating
            : undefined,
        title: typeof entry.title === 'string' ? entry.title : undefined,
        usageCount: typeof entry.usageCount === 'number' ? entry.usageCount : undefined,
      }))
      .filter(entry => entry.id.length > 0),
  };
}

export class BrowseCommand extends BaseCommand {
  constructor() {
    super('browse', 'Browse and discover community blueprints');
  }

  configureOptions(command: Command): Command {
    return command
      .option('--community', 'Show community-contributed blueprints', false)
      .option('--trending', 'Show trending blueprints', false)
      .option('--category <category>', 'Filter by category')
      .option('--framework <framework>', 'Filter by framework')
      .option('--platform <platform>', 'Filter by platform compatibility')
      .option('--kind <kind>', 'Filter by canonical kind')
      .option('--specificity <layer>', 'Filter by specificity layer (L0..L4)')
      .option('--include-l4', 'Include provenance variants (L4)', false)
      .option('--limit <number>', 'Limit results', '20')
      .option('--source <source>', 'Source: hub, repository, or both', 'both');
  }

  async execute(options: BrowseCommandOptions): Promise<{ success: true }> {
    await commandContext.initialize();
    this.showHeader('VDK Blueprint Discovery');

    if (options.community || options.trending) {
      await this.browseCommunityBlueprints(options);
    } else {
      await this.browseRepositoryBlueprints(options);
    }

    this.showBrowseTips();

    return { success: true };
  }

  async browseCommunityBlueprints(options: BrowseCommandOptions): Promise<void> {
    if (!this.hubOps) {
      this.showBrowseTips();
      this.exitWithError(
        'Hub integration required for community features. Please check your connection.'
      );
    }

    const spinner = this.createSpinner('Fetching community blueprints...');
    spinner.start();

    try {
      const limit = parseLimit(options.limit);
      let results: CommunityBlueprintResponse;

      if (options.trending) {
        if (typeof this.hubOps.getTrendingBlueprints !== 'function') {
          throw new Error('Trending blueprint lookup is unavailable');
        }

        const rawResults = await this.hubOps.getTrendingBlueprints({
          limit,
          timeframe: '7d',
        });
        results = normalizeCommunityBlueprintResponse(rawResults);
      } else {
        const hubClientModule: HubClientModule = await import('../../hub/VDKHubClient.js');
        const hubClient = new hubClientModule.VDKHubClient();
        results = await hubClient.searchCommunityBlueprints({
          category: options.category,
          framework: options.framework,
          limit,
          platform: options.platform,
        });
      }

      const blueprints = results.blueprints ?? [];
      spinner.succeed(`Found ${blueprints.length} blueprints`);

      writeStdout('');
      writeStdout(`${options.trending ? 'Trending' : 'Community'} Blueprints`);

      if (blueprints.length === 0) {
        this.logInfo('No community blueprints found. Try adjusting your filters.');
        return;
      }

      for (const blueprint of blueprints) {
        writeStdout('');
        writeStdout(`📝 ${blueprint.title ?? 'Untitled'} by @${blueprint.author ?? 'community'}`);
        writeStdout(`   ${blueprint.description ?? 'No description'}`);
        writeStdout(
          `   Used ${blueprint.usageCount ?? 0} times | Rating ${blueprint.rating ?? 'N/A'}`
        );
        writeStdout(`   Deploy: ${colors.primary(`vdk deploy ${blueprint.id}`)}`);
      }
    } catch (error) {
      spinner.fail('Failed to fetch community blueprints');
      throw error;
    }
  }

  async browseRepositoryBlueprints(options: BrowseCommandOptions): Promise<void> {
    const spinner = this.createSpinner('Fetching blueprints...');
    spinner.start();

    try {
      const searchModule: SearchBlueprintsModule = await import('../../blueprints-client.js');
      const limit = parseLimit(options.limit);
      const criteria: SearchBlueprintsCriteria = {
        category: options.category,
        framework: options.framework,
        includeL4: options.includeL4 === true,
        kind: options.kind,
        limit,
        platform: options.platform,
        specificity: options.specificity,
      };
      const blueprints = await searchModule.searchBlueprints(criteria);
      const displayBlueprints = blueprints.slice(0, limit);

      spinner.succeed(`Found ${blueprints.length} blueprints`);

      writeStdout('');
      for (const [index, blueprint] of displayBlueprints.entries()) {
        const metadata = blueprint.metadata ?? {};
        writeStdout(`${index + 1}. ${colors.primary(metadata.title ?? 'Untitled')}`);
        writeStdout(`   ${metadata.description ?? 'No description'}`);
        writeStdout(
          `   Category: ${metadata.category ?? 'General'} | Complexity: ${metadata.complexity ?? 'Unknown'}`
        );
        writeStdout(
          `   Kind: ${blueprint.retrieval?.canonicalKind ?? 'unknown'} | Layer: ${blueprint.retrieval?.specificityLayer ?? 'unknown'}`
        );

        if (metadata.platforms) {
          const platforms = Object.entries(metadata.platforms)
            .filter(([, config]) => config.enabled !== false)
            .map(([platformId]) => platformId);
          writeStdout(`   Platforms: ${platforms.join(', ') || 'All'}`);
        }

        writeStdout(`   Deploy: ${colors.primary(`vdk deploy ${metadata.id ?? ''}`)}`);
        writeStdout('');
      }

      if (blueprints.length > limit) {
        this.logInfo(
          `Showing ${limit} of ${blueprints.length} blueprints. Use --limit to see more.`
        );
      }
    } catch (error) {
      spinner.fail('Failed to fetch repository blueprints');
      throw error;
    }
  }

  showBrowseTips(): void {
    writeStdout('');
    this.logInfo('💡 Tips:');
    this.logInfo('Use --community for user-contributed blueprints');
    this.logInfo('Use --trending to see popular blueprints');
    this.logInfo('Filter by --framework, --category, or --platform');
  }
}
