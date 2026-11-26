/**
 * SearchCommand
 * -----------------------
 * Search VDK-Blueprints repository using canonical AI Context Schema v3 metadata.
 * Supports advanced filtering by platform, category, complexity, and more.
 */

import type { Command } from 'commander';

import { tables } from '../../utils/cli-styles.js';
import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type PlatformCompatibility = {
  enabled?: boolean;
};

type BlueprintMetadata = {
  author?: string;
  category?: string;
  created?: string;
  description?: string;
  id?: string;
  name?: string;
  platforms?: Record<string, PlatformCompatibility>;
  tags?: string[];
  title?: string;
};

type BlueprintSearchResult = {
  complexity?: string;
  maturity?: string;
  metadata?: BlueprintMetadata;
  name?: string;
  platforms?: Record<string, PlatformCompatibility>;
  retrieval?: {
    canonicalKind?: string;
    canonicalName?: string;
    specificityLayer?: string;
  };
};

type SearchCriteria = {
  audience?: string;
  auditProvenance?: boolean;
  category?: string;
  complexity?: string;
  exactMatch?: boolean;
  fuzzy?: boolean;
  includeL4?: boolean;
  kind?: string;
  limit?: string;
  maturity?: string;
  platform?: string;
  query?: string;
  scope?: string;
  specificity?: string;
  tags?: string[];
};

type SearchBlueprintsModule = {
  searchBlueprints: (criteria: SearchCriteria) => Promise<BlueprintSearchResult[]>;
};

type SearchCommandOptions = SearchCriteria & {
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

export class SearchCommand extends BaseCommand {
  constructor() {
    super(
      'search',
      'Search VDK-Blueprints repository using canonical AI Context Schema v3 metadata'
    );
  }

  configureOptions(command: Command): Command {
    return command
      .option('-q, --query <text>', 'Search query for name/title/description')
      .option('--exact-match', 'Require exact canonical/id match for query', false)
      .option('--fuzzy', 'Enable fuzzy matching when query is provided', false)
      .option(
        '-p, --platform <platform>',
        'Filter by platform compatibility (claude-code, cursor, windsurf, etc.)'
      )
      .option('-c, --category <category>', 'Filter by category (core, language, technology, etc.)')
      .option(
        '--kind <kind>',
        'Filter by canonical kind (project-memory, conditional-rule, skill, command, workflow, agent, hook, mcp-integration, plugin-distribution)'
      )
      .option('--specificity <layer>', 'Filter by specificity layer (L0, L1, L2, L3, L4)')
      .option('--include-l4', 'Include provenance variants (L4) in results', false)
      .option('--audit-provenance', 'Show provenance variants without deduplication', false)
      .option('--complexity <level>', 'Filter by complexity (simple, medium, complex)')
      .option('--scope <scope>', 'Filter by scope (file, component, feature, project, system)')
      .option('--audience <audience>', 'Filter by audience (developer, architect, team-lead, etc.)')
      .option(
        '--maturity <maturity>',
        'Filter by maturity (experimental, beta, stable, deprecated)'
      )
      .option('--tags <tags...>', 'Filter by tags (space-separated)')
      .option('--limit <number>', 'Limit number of results', '20')
      .option('-v, --verbose', 'Show detailed blueprint information', false);
  }

  async execute(options: SearchCommandOptions): Promise<{
    criteria: SearchCriteria;
    results: BlueprintSearchResult[];
    total: number;
  }> {
    await commandContext.initialize();
    this.showHeader();

    try {
      const criteria = this.buildSearchCriteria(options);
      this.displaySearchCriteria(criteria);

      const searchModule: SearchBlueprintsModule = await import('../../blueprints-client.js');
      const results = await searchModule.searchBlueprints(criteria);
      const limitedResults = results.slice(0, parseLimit(options.limit));

      if (limitedResults.length === 0) {
        this.logWarning('No blueprints found matching your criteria');
        return { criteria, results: [], total: 0 };
      }

      this.displaySearchResults(limitedResults, results.length, options);

      this.trackSuccess({
        criteria: Object.keys(criteria),
        displayedResults: limitedResults.length,
        totalResults: results.length,
      });

      return {
        criteria,
        results: limitedResults,
        total: results.length,
      };
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(String(error));
      this.exitWithError(`Search failed: ${commandError.message}`, commandError);
    }
  }

  buildSearchCriteria(options: SearchCommandOptions): SearchCriteria {
    const criteria: SearchCriteria = {};

    if (options.query) criteria.query = options.query;
    if (options.exactMatch) criteria.exactMatch = true;
    if (options.fuzzy) criteria.fuzzy = true;
    if (options.platform) criteria.platform = options.platform;
    if (options.category) criteria.category = options.category;
    if (options.kind) criteria.kind = options.kind;
    if (options.specificity) criteria.specificity = options.specificity;
    if (options.includeL4) criteria.includeL4 = true;
    if (options.auditProvenance) criteria.auditProvenance = true;
    if (options.complexity) criteria.complexity = options.complexity;
    if (options.scope) criteria.scope = options.scope;
    if (options.audience) criteria.audience = options.audience;
    if (options.maturity) criteria.maturity = options.maturity;
    if (options.tags) criteria.tags = options.tags;
    if (options.limit) criteria.limit = options.limit;

    return criteria;
  }

  displaySearchCriteria(criteria: SearchCriteria): void {
    if (Object.keys(criteria).length === 0) {
      writeStdout('Search criteria: All blueprints');
      return;
    }

    writeStdout(`Search criteria: ${JSON.stringify(criteria)}`);
  }

  displaySearchResults(
    results: BlueprintSearchResult[],
    totalResults: number,
    options: SearchCommandOptions
  ): void {
    const searchTable: BasicTable = tables.basic();

    searchTable.push([
      this.colorPrimary('Name'),
      this.colorPrimary('Title'),
      this.colorPrimary('Kind'),
      this.colorPrimary('Layer'),
      this.colorPrimary('Category'),
      this.colorPrimary('Complexity'),
      this.colorPrimary('Maturity'),
      this.colorPrimary('Platforms'),
    ]);

    for (const blueprint of results) {
      const displayName = this.getBlueprintDisplayName(blueprint);
      const platforms = Object.entries(blueprint.platforms ?? {})
        .filter(([, config]) => config.enabled !== false)
        .slice(0, 3)
        .map(([platformId]) => platformId)
        .join(', ');
      const platformCount = Object.keys(blueprint.platforms ?? {}).length;
      const platformsDisplay = platforms + (platformCount > 3 ? '...' : '');

      searchTable.push([
        displayName,
        (blueprint.metadata?.title ?? displayName ?? 'Untitled').substring(0, 30),
        blueprint.retrieval?.canonicalKind ?? 'unknown',
        blueprint.retrieval?.specificityLayer ?? 'unknown',
        blueprint.metadata?.category ?? 'Unknown',
        blueprint.complexity ?? 'Unknown',
        blueprint.maturity ?? 'Unknown',
        platformsDisplay,
      ]);
    }

    writeStdout(searchTable.toString());

    const limit = parseLimit(options.limit);
    const limitText = totalResults > limit ? ` (showing ${limit})` : '';
    writeStdout('');
    writeStdout(`Found ${totalResults} blueprints${limitText}`);

    if (options.verbose && results.length > 0) {
      this.showDetailedInfo(results);
    }
  }

  getBlueprintDisplayName(blueprint: BlueprintSearchResult): string {
    const sourceName = blueprint.name?.replace(/\.(md|mdc|json)$/i, '');
    return (
      blueprint.metadata?.name ??
      blueprint.metadata?.id ??
      blueprint.retrieval?.canonicalName ??
      sourceName ??
      'Unknown'
    );
  }

  showDetailedInfo(results: BlueprintSearchResult[]): void {
    writeStdout('');
    writeStdout(this.colorCyan('Detailed Blueprint Information:'));
    writeStdout('');

    for (const [index, blueprint] of results.slice(0, 5).entries()) {
      const displayName = this.getBlueprintDisplayName(blueprint);
      writeStdout(this.colorPrimary(`${index + 1}. ${blueprint.metadata?.title ?? displayName}`));
      writeStdout(`   Description: ${blueprint.metadata?.description ?? 'No description'}`);
      writeStdout(`   Kind: ${blueprint.retrieval?.canonicalKind ?? 'unknown'}`);
      writeStdout(`   Layer: ${blueprint.retrieval?.specificityLayer ?? 'unknown'}`);
      writeStdout(`   Tags: ${(blueprint.metadata?.tags ?? []).join(', ') || 'None'}`);
      writeStdout(`   Author: ${blueprint.metadata?.author ?? 'Unknown'}`);
      writeStdout(`   Created: ${blueprint.metadata?.created ?? 'Unknown'}`);
      writeStdout('');
    }

    if (results.length > 5) {
      this.logInfo(`... and ${results.length - 5} more blueprints`);
    }

    this.logInfo('Use "vdk deploy <blueprint-name>" to deploy a blueprint');
  }
}
