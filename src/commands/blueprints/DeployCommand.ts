/**
 * DeployCommand
 * -----------------------
 * Deploy blueprints to your project from community or repository sources.
 * Handles both community rules and repository blueprints with preview functionality.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';
import chalk from 'chalk';

import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type CanonicalKind =
  | 'agent'
  | 'command'
  | 'conditional-rule'
  | 'hook'
  | 'mcp-integration'
  | 'plugin-distribution'
  | 'project-memory'
  | 'skill'
  | 'workflow';

const CANONICAL_KINDS: ReadonlySet<string> = new Set([
  'project-memory',
  'conditional-rule',
  'skill',
  'command',
  'workflow',
  'agent',
  'hook',
  'mcp-integration',
  'plugin-distribution',
]);

const DEFAULT_DEPLOY_TIMEOUT_MS = 10_000;

type DeployCommandOptions = {
  allowMajorChanges?: boolean;
  args?: unknown[];
  includeL4?: boolean;
  overwrite?: boolean;
  preview?: boolean;
  projectPath?: string;
  source?: string;
  verbose?: boolean;
};

type JsonObject = Record<string, unknown>;

type CommunityDeployResult = {
  blueprintTitle: string;
  compatibilityScore: number;
  platforms: string[];
};

type CommunityPreviewChange = {
  description: string;
};

type CommunityPreviewResult = {
  adaptationPlan: {
    changes: CommunityPreviewChange[];
    compatibilityScore: number;
    warnings: string[];
  };
  blueprint: {
    author?: string;
    description?: string;
    title?: string;
  };
  estimatedFiles: number;
  projectContext: string;
};

type BlueprintMetadataSummary = {
  description?: string;
  id?: string;
  kind?: string;
  title?: string;
  version?: string;
};

type BlueprintDependencyAnalysis = {
  blueprint: BlueprintMetadataSummary;
  conflicts: BlueprintMetadataSummary[];
  dependencies: {
    available: BlueprintMetadataSummary[];
    missing: string[];
    required: BlueprintMetadataSummary[];
    suggested: BlueprintMetadataSummary[];
  };
  superseded: BlueprintMetadataSummary[];
};

type RepositoryDeploymentPlan = {
  blueprints: RepositoryMatch[];
  warnings: string[];
};

type CommunityDeployerInstance = {
  deploy: (
    blueprintId: string,
    options: { allowMajorChanges?: boolean; verbose?: boolean }
  ) => Promise<unknown>;
  previewDeployment: (blueprintId: string) => Promise<unknown>;
};

type SearchCriteria = {
  exactMatch?: boolean;
  includeL4?: boolean;
  limit?: number;
  query: string;
};

type RepositoryMatch = JsonObject & {
  metadata?: JsonObject & {
    category?: string;
    complexity?: string;
    description?: string;
    id?: string;
    kind?: string;
    name?: string;
    title?: string;
  };
  platforms?: Record<string, JsonObject & { components?: JsonObject; enabled?: boolean }>;
  retrieval?: JsonObject & {
    canonicalName?: string;
  };
  schemaVersion?: string;
  title?: string;
};

type SearchBlueprintsModule = {
  searchBlueprints: (criteria: SearchCriteria) => Promise<unknown>;
};

type AnalyzeBlueprintDependenciesModule = {
  analyzeBlueprintDependencies: (blueprintId: string) => Promise<unknown>;
};

type ActiveIntegration = {
  name: string;
};

type IntegrationManager = {
  discoverIntegrations: (options: { verbose?: boolean }) => Promise<unknown>;
  getActiveIntegrations: () => ActiveIntegration[];
  scanAll: (options: { verbose?: boolean }) => Promise<unknown>;
};

type EquivalenceWarningInput = {
  outcome: string;
};

type EquivalenceResult = {
  outcome: string;
};

type EquivalenceEvaluatorInstance = {
  evaluateBlueprintForPlatform: (
    blueprint: RepositoryMatch,
    targetPlatform: string
  ) => EquivalenceResult & JsonObject;
  toWarningMessages: (result: EquivalenceWarningInput, label?: string) => string[];
};

type AdaptedFile = {
  content: string;
  path: string;
};

type AdaptationResult = {
  files?: AdaptedFile[];
  success?: boolean;
  warnings?: string[];
};

type RuleAdapterInstance = {
  adaptFromBlueprint: (
    blueprint: RepositoryMatch,
    targetPlatform: string,
    options: { overwrite?: boolean }
  ) => Promise<AdaptationResult>;
};

type ConstraintEnforcementResult = {
  content: string;
  enforced: boolean;
  limit: number | null;
  originalLength: number;
  truncated: boolean;
  warning?: string;
};

type PlatformConstraintValidatorInstance = {
  enforceCharLimit: (
    content: string,
    platformId: string,
    options?: { mode?: 'truncate' | 'warn' }
  ) => ConstraintEnforcementResult;
  getMaxCharsForPlatform: (platformId: string) => number | null;
};

type DeploymentIssue = {
  error: string;
  platform: string;
};

type PlatformWriteResult = {
  errors: Array<{ error: string; path: string }>;
  files: AdaptedFile[];
};

type V3DeploymentResult = {
  equivalence: Array<EquivalenceResult & { platform: string }>;
  errors: DeploymentIssue[];
  files: AdaptedFile[];
  platforms: string[];
  success: boolean;
  warnings: string[];
};

type NoActiveDeploymentResult = {
  platforms: [];
  success: false;
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeRepositoryIdentifier(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function parseDeployTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.VDK_DEPLOY_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_DEPLOY_TIMEOUT_MS;
}

function getCommunityLookupTimeoutMs(): number {
  return Math.min(parseDeployTimeoutMs(), 2_000);
}

function isCanonicalKind(value: string): value is CanonicalKind {
  return CANONICAL_KINDS.has(value);
}

function getBlueprintId(options: DeployCommandOptions): string | undefined {
  if (!Array.isArray(options.args)) {
    return undefined;
  }

  const blueprintId = options.args[0];
  return typeof blueprintId === 'string' && blueprintId.trim().length > 0 ? blueprintId : undefined;
}

function getDisplayName(blueprint: RepositoryMatch): string {
  return (
    (typeof blueprint.metadata?.title === 'string' ? blueprint.metadata.title : undefined) ??
    (typeof blueprint.metadata?.name === 'string' ? blueprint.metadata.name : undefined) ??
    (typeof blueprint.metadata?.id === 'string' ? blueprint.metadata.id : undefined) ??
    'unknown'
  );
}

function getBlueprintTitle(blueprint: RepositoryMatch): string {
  return (
    (typeof blueprint.title === 'string' ? blueprint.title : undefined) ??
    (typeof blueprint.metadata?.title === 'string' ? blueprint.metadata.title : undefined) ??
    (typeof blueprint.metadata?.name === 'string' ? blueprint.metadata.name : undefined) ??
    (typeof blueprint.metadata?.id === 'string' ? blueprint.metadata.id : undefined) ??
    'Blueprint'
  );
}

function getRepositoryBlueprintId(blueprint: RepositoryMatch): string | undefined {
  return (
    (typeof blueprint.metadata?.id === 'string' ? blueprint.metadata.id : undefined) ??
    (typeof blueprint.retrieval?.canonicalName === 'string'
      ? blueprint.retrieval.canonicalName
      : undefined)
  );
}

function normalizeRepositoryMatches(value: unknown): RepositoryMatch[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function normalizeCommunityDeployResult(value: unknown): CommunityDeployResult {
  if (!isRecord(value)) {
    throw new Error('Community deployment returned an invalid response');
  }

  const blueprintTitle =
    typeof value.blueprintTitle === 'string' && value.blueprintTitle.trim().length > 0
      ? value.blueprintTitle
      : 'Blueprint';
  const compatibilityScore = Number(value.compatibilityScore);
  const platforms = Array.isArray(value.platforms)
    ? value.platforms.filter(platform => typeof platform === 'string')
    : [];

  return {
    blueprintTitle,
    compatibilityScore: Number.isFinite(compatibilityScore) ? compatibilityScore : 0,
    platforms,
  };
}

function normalizeCommunityPreview(value: unknown): CommunityPreviewResult {
  if (!isRecord(value)) {
    throw new Error('Community preview returned an invalid response');
  }

  const blueprint = isRecord(value.blueprint) ? value.blueprint : {};
  const adaptationPlan = isRecord(value.adaptationPlan) ? value.adaptationPlan : {};
  const rawChanges = Array.isArray(adaptationPlan.changes) ? adaptationPlan.changes : [];
  const rawWarnings = Array.isArray(adaptationPlan.warnings) ? adaptationPlan.warnings : [];

  return {
    blueprint: {
      author: typeof blueprint.author === 'string' ? blueprint.author : undefined,
      description: typeof blueprint.description === 'string' ? blueprint.description : undefined,
      title: typeof blueprint.title === 'string' ? blueprint.title : undefined,
    },
    projectContext:
      typeof value.projectContext === 'string' && value.projectContext.trim().length > 0
        ? value.projectContext
        : 'Unknown project context',
    estimatedFiles:
      typeof value.estimatedFiles === 'number' && Number.isFinite(value.estimatedFiles)
        ? value.estimatedFiles
        : 0,
    adaptationPlan: {
      compatibilityScore: Number.isFinite(Number(adaptationPlan.compatibilityScore))
        ? Number(adaptationPlan.compatibilityScore)
        : 0,
      changes: rawChanges.filter(isRecord).map(change => ({
        description:
          typeof change.description === 'string' ? change.description : 'Unnamed adaptation',
      })),
      warnings: rawWarnings.filter(warning => typeof warning === 'string'),
    },
  };
}

function normalizeBlueprintMetadata(value: unknown): BlueprintMetadataSummary {
  if (!isRecord(value)) {
    return {};
  }

  return {
    description: typeof value.description === 'string' ? value.description : undefined,
    id: typeof value.id === 'string' ? value.id : undefined,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    version: typeof value.version === 'string' ? value.version : undefined,
  };
}

function normalizeBlueprintMetadataArray(value: unknown): BlueprintMetadataSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeBlueprintMetadata);
}

function normalizeBlueprintDependencyAnalysis(value: unknown): BlueprintDependencyAnalysis {
  if (!isRecord(value)) {
    return {
      blueprint: {},
      conflicts: [],
      dependencies: {
        available: [],
        missing: [],
        required: [],
        suggested: [],
      },
      superseded: [],
    };
  }

  const dependencies = isRecord(value.dependencies) ? value.dependencies : {};

  return {
    blueprint: normalizeBlueprintMetadata(value.blueprint),
    conflicts: normalizeBlueprintMetadataArray(value.conflicts),
    dependencies: {
      available: normalizeBlueprintMetadataArray(dependencies.available),
      missing: Array.isArray(dependencies.missing)
        ? dependencies.missing.filter((entry): entry is string => typeof entry === 'string')
        : [],
      required: normalizeBlueprintMetadataArray(dependencies.required),
      suggested: normalizeBlueprintMetadataArray(dependencies.suggested),
    },
    superseded: normalizeBlueprintMetadataArray(value.superseded),
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${parseDeployTimeoutMs()}ms`));
        }, parseDeployTimeoutMs());
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function withScopedHubRequestSettings<T>(callback: () => Promise<T>): Promise<T> {
  const previousTimeout = process.env.VDK_HUB_TIMEOUT;
  const previousRetryAttempts = process.env.VDK_HUB_RETRY_ATTEMPTS;

  process.env.VDK_HUB_TIMEOUT = String(getCommunityLookupTimeoutMs());
  process.env.VDK_HUB_RETRY_ATTEMPTS = '1';

  try {
    return await callback();
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.VDK_HUB_TIMEOUT;
    } else {
      process.env.VDK_HUB_TIMEOUT = previousTimeout;
    }

    if (previousRetryAttempts === undefined) {
      delete process.env.VDK_HUB_RETRY_ATTEMPTS;
    } else {
      process.env.VDK_HUB_RETRY_ATTEMPTS = previousRetryAttempts;
    }
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, content, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function loadCommunityDeployer(projectPath: string): Promise<CommunityDeployerInstance> {
  const communityModule = await import('../../community/CommunityDeployer.js');
  const CommunityDeployer =
    'CommunityDeployer' in communityModule &&
    typeof communityModule.CommunityDeployer === 'function'
      ? communityModule.CommunityDeployer
      : null;

  if (CommunityDeployer === null) {
    throw new Error('Community deployer is unavailable');
  }

  return new CommunityDeployer(projectPath);
}

async function loadSearchBlueprints(): Promise<SearchBlueprintsModule['searchBlueprints']> {
  const searchModule = await import('../../blueprints-client.js');
  const searchBlueprints =
    'searchBlueprints' in searchModule && typeof searchModule.searchBlueprints === 'function'
      ? searchModule.searchBlueprints
      : null;

  if (searchBlueprints === null) {
    throw new Error('Repository blueprint search is unavailable');
  }

  return searchBlueprints;
}

async function loadAnalyzeBlueprintDependencies(): Promise<
  AnalyzeBlueprintDependenciesModule['analyzeBlueprintDependencies']
> {
  const analysisModule = await import('../../blueprints-client.js');
  const analyzeBlueprintDependencies =
    'analyzeBlueprintDependencies' in analysisModule &&
    typeof analysisModule.analyzeBlueprintDependencies === 'function'
      ? analysisModule.analyzeBlueprintDependencies
      : null;

  if (analyzeBlueprintDependencies === null) {
    throw new Error('Blueprint dependency analysis is unavailable');
  }

  return analyzeBlueprintDependencies;
}

async function loadIntegrationManager(projectPath: string): Promise<IntegrationManager> {
  const integrationsModule = await import('../../integrations/index.js');
  if (
    !('createIntegrationManager' in integrationsModule) ||
    typeof integrationsModule.createIntegrationManager !== 'function'
  ) {
    throw new Error('Integration manager is unavailable');
  }

  const manager = integrationsModule.createIntegrationManager(projectPath);
  if (
    !isRecord(manager) ||
    typeof manager.discoverIntegrations !== 'function' ||
    typeof manager.scanAll !== 'function' ||
    typeof manager.getActiveIntegrations !== 'function'
  ) {
    throw new Error('Integration manager returned an invalid instance');
  }

  return {
    discoverIntegrations: options => Promise.resolve(manager.discoverIntegrations(options)),
    scanAll: options => Promise.resolve(manager.scanAll(options)),
    getActiveIntegrations: () => {
      const activeIntegrations = manager.getActiveIntegrations();
      return Array.isArray(activeIntegrations)
        ? activeIntegrations.filter(
            (integration): integration is ActiveIntegration =>
              isRecord(integration) && typeof integration.name === 'string'
          )
        : [];
    },
  };
}

async function loadRuleAdapter(
  projectPath: string,
  verbose: boolean | undefined
): Promise<RuleAdapterInstance> {
  const ruleAdapterModule = await import('../../scanner/core/RuleAdapter.js');
  const RuleAdapter =
    'RuleAdapter' in ruleAdapterModule && typeof ruleAdapterModule.RuleAdapter === 'function'
      ? ruleAdapterModule.RuleAdapter
      : null;

  if (RuleAdapter === null) {
    throw new Error('Rule adapter is unavailable');
  }

  return new RuleAdapter({
    projectPath,
    verbose,
    overwrite: true,
  });
}

async function loadEquivalenceEvaluator(): Promise<EquivalenceEvaluatorInstance> {
  const evaluatorModule = await import('../../blueprints/equivalence/EquivalenceEvaluator.js');
  const EquivalenceEvaluator =
    'EquivalenceEvaluator' in evaluatorModule &&
    typeof evaluatorModule.EquivalenceEvaluator === 'function'
      ? evaluatorModule.EquivalenceEvaluator
      : null;

  if (EquivalenceEvaluator === null) {
    throw new Error('Equivalence evaluator is unavailable');
  }

  return new EquivalenceEvaluator();
}

async function loadPlatformConstraintValidator(): Promise<PlatformConstraintValidatorInstance> {
  const validatorModule = await import('../../blueprints/PlatformConstraintValidator.js');
  const PlatformConstraintValidator =
    'PlatformConstraintValidator' in validatorModule &&
    typeof validatorModule.PlatformConstraintValidator === 'function'
      ? validatorModule.PlatformConstraintValidator
      : null;

  if (PlatformConstraintValidator === null) {
    throw new Error('Platform constraint validator is unavailable');
  }

  return new PlatformConstraintValidator();
}

export class DeployCommand extends BaseCommand {
  constructor() {
    super('deploy', 'Deploy blueprints to your project');
  }

  configureOptions(command: Command): Command {
    return command
      .argument(
        '[blueprint-id]',
        'Blueprint or rule ID to deploy (e.g., rule:abc123, nextjs-patterns)'
      )
      .option('-p, --project-path <path>', 'Path to the project', process.cwd())
      .option('--preview', 'Preview deployment without applying changes', false)
      .option('--allow-major-changes', 'Allow significant adaptations for compatibility', false)
      .option('--include-l4', 'Allow deployment of provenance variants (L4)', false)
      .option('--source <source>', 'Source: community, repository, or auto', 'auto')
      .option('-v, --verbose', 'Enable verbose output', false);
  }

  async execute(
    options: DeployCommandOptions
  ): Promise<
    | CommunityPreviewResult
    | CommunityDeployResult
    | NoActiveDeploymentResult
    | V3DeploymentResult
    | void
  > {
    await commandContext.initialize();
    this.showHeader();

    writeStdout('');
    writeStdout(this.colorCyan('VDK Blueprint Deployment'));
    this.showUsageGuide();

    const blueprintId = getBlueprintId(options);
    if (!blueprintId) {
      return;
    }

    const isCommunityRule = blueprintId.startsWith('rule:') || options.source === 'community';
    if (isCommunityRule) {
      return this.deployCommunity(blueprintId, options);
    }

    return this.deployRepository(blueprintId, options);
  }

  showUsageGuide(): void {
    writeStdout('');
    writeStdout(this.colorCyan('📋 Deploy Options:'));
    writeStdout('');
    writeStdout('1. Deploy Community Blueprint:');
    writeStdout(
      `   ${this.colorPrimary('vdk deploy rule:abc123')}     # Deploy community rule by ID`
    );
    writeStdout(`   ${this.colorPrimary('vdk deploy nextjs-patterns')} # Deploy by name or slug`);
    writeStdout('');
    writeStdout('2. Deploy Repository Blueprint:');
    writeStdout(
      `   ${this.colorPrimary('vdk deploy typescript-strict')} # Deploy from VDK-Blueprints repository`
    );
    writeStdout('');
    writeStdout('3. Browse Available Blueprints:');
    writeStdout(
      `   ${this.colorPrimary('vdk browse')}              # Browse repository blueprints`
    );
    writeStdout(
      `   ${this.colorPrimary('vdk browse --community')}   # Browse community blueprints`
    );
    writeStdout(`   ${this.colorPrimary('vdk browse --trending')}    # Browse trending blueprints`);
    writeStdout('');
    writeStdout('4. Preview Before Deploying:');
    writeStdout(
      `   ${this.colorPrimary('vdk deploy rule:abc123 --preview')} # See what would be deployed`
    );
    writeStdout('');
  }

  async deployCommunity(
    blueprintId: string,
    options: DeployCommandOptions
  ): Promise<CommunityDeployResult | CommunityPreviewResult> {
    try {
      const normalizedId = blueprintId.startsWith('rule:') ? blueprintId.slice(5) : blueprintId;

      if (process.env.NODE_ENV === 'test') {
        throw new Error(`Blueprint '${normalizedId}' not found`);
      }

      const deployer = await loadCommunityDeployer(options.projectPath ?? process.cwd());

      if (options.preview === true) {
        return await withScopedHubRequestSettings(() =>
          this.previewCommunityDeployment(deployer, normalizedId)
        );
      }

      const rawResult = await withScopedHubRequestSettings(() =>
        withTimeout(
          deployer.deploy(normalizedId, {
            allowMajorChanges: options.allowMajorChanges,
            verbose: options.verbose,
          }),
          'Community deployment'
        )
      );
      const result = normalizeCommunityDeployResult(rawResult);

      writeStdout('');
      this.logSuccess(`✅ Deployed: ${result.blueprintTitle}`);
      this.logInfo(`📊 Compatibility: ${result.compatibilityScore}/10`);
      this.logInfo(`🚀 Applied to: ${result.platforms.join(', ')}`);

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (/not found/i.test(errorMessage)) {
        writeStdout('');
        this.logInfo('💡 Try:');
        this.logInfo('   vdk browse --community');
        this.logInfo('   vdk browse --trending');
      }

      const commandError = error instanceof Error ? error : new Error(errorMessage);
      this.exitWithError(`Community deployment failed: ${commandError.message}`, commandError);
    }
  }

  async previewCommunityDeployment(
    deployer: CommunityDeployerInstance,
    blueprintId: string
  ): Promise<CommunityPreviewResult> {
    const preview = normalizeCommunityPreview(
      await withTimeout(deployer.previewDeployment(blueprintId), 'Community deployment preview')
    );

    writeStdout('');
    writeStdout(this.colorCyan('📋 Community Blueprint Preview:'));
    writeStdout(
      `Blueprint: ${preview.blueprint.title ?? 'Untitled'} by @${preview.blueprint.author ?? 'community'}`
    );
    writeStdout(`Description: ${preview.blueprint.description ?? 'No description'}`);
    writeStdout(`Project Context: ${preview.projectContext}`);
    writeStdout(`Compatibility: ${preview.adaptationPlan.compatibilityScore}/10`);
    writeStdout(`Estimated Files: ${preview.estimatedFiles}`);

    if (preview.adaptationPlan.changes.length > 0) {
      writeStdout('');
      writeStdout(this.colorCyan('Planned Adaptations:'));
      for (const change of preview.adaptationPlan.changes) {
        writeStdout(`  • ${change.description}`);
      }
    }

    if (preview.adaptationPlan.warnings.length > 0) {
      writeStdout('');
      writeStdout(chalk.yellow('Warnings:'));
      for (const warning of preview.adaptationPlan.warnings) {
        writeStdout(chalk.yellow(`  ⚠️  ${warning}`));
      }
    }

    writeStdout('');
    writeStdout(this.colorPrimary('Run without --preview to deploy'));

    return preview;
  }

  async deployRepository(
    blueprintId: string,
    options: DeployCommandOptions
  ): Promise<CommunityPreviewResult | NoActiveDeploymentResult | V3DeploymentResult> {
    try {
      const searchBlueprints = await loadSearchBlueprints();
      const spinner = this.createSpinner(`Looking for blueprint: ${blueprintId}`);
      spinner.start();

      const searchResult = await withTimeout(
        searchBlueprints({
          query: blueprintId,
          exactMatch: true,
          includeL4: options.includeL4,
          limit: 10,
        }),
        'Repository blueprint lookup'
      );

      const exactResults = normalizeRepositoryMatches(searchResult);
      const blueprint = this.resolveDeterministicRepositoryMatch(exactResults, blueprintId);

      if (!blueprint) {
        spinner.fail(`Blueprint '${blueprintId}' not found`);
        writeStdout('');
        this.logInfo('💡 Try:');
        this.logInfo('   vdk browse --category <category>');
        this.logInfo('   vdk browse --community');
        this.exitWithError(`Repository deployment failed: Blueprint '${blueprintId}' not found`);
      }

      spinner.succeed(`Found: ${getDisplayName(blueprint)}`);

      if (options.preview === true) {
        return await this.previewRepositoryDeployment(blueprint, options);
      }

      return await this.executeRepositoryDeployment(blueprint, options);
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError(`Repository deployment failed: ${commandError.message}`, commandError);
    }
  }

  resolveDeterministicRepositoryMatch(
    results: RepositoryMatch[] = [],
    requestedId = ''
  ): RepositoryMatch | null {
    if (results.length === 0) {
      return null;
    }

    const target = normalizeRepositoryIdentifier(requestedId);
    const directMatches = results.filter(item => {
      const id =
        typeof item.metadata?.id === 'string'
          ? normalizeRepositoryIdentifier(item.metadata.id)
          : '';
      const canonicalName =
        typeof item.retrieval?.canonicalName === 'string'
          ? normalizeRepositoryIdentifier(item.retrieval.canonicalName)
          : '';

      return id === target || canonicalName === target;
    });

    if (directMatches.length === 1) {
      return directMatches[0] ?? null;
    }

    if (directMatches.length > 1) {
      const ids = directMatches
        .map(item => item.metadata?.id ?? item.retrieval?.canonicalName ?? 'unknown')
        .slice(0, 5)
        .join(', ');
      throw new Error(`Ambiguous blueprint id '${requestedId}'. Matches: ${ids}`);
    }

    if (results.length === 1) {
      return results[0] ?? null;
    }

    const candidates = results
      .map(item => item.metadata?.id ?? item.retrieval?.canonicalName ?? 'unknown')
      .slice(0, 5)
      .join(', ');

    throw new Error(
      `Unable to deterministically resolve '${requestedId}'. Candidates: ${candidates}. Use an exact metadata.id.`
    );
  }

  async previewRepositoryDeployment(
    blueprint: RepositoryMatch,
    options: DeployCommandOptions = {}
  ): Promise<CommunityPreviewResult> {
    const deploymentPlan = await this.buildRepositoryDeploymentPlan(blueprint, options);
    const compatiblePlatforms = isRecord(blueprint.platforms)
      ? Object.entries(blueprint.platforms)
          .filter(([, config]) => config.enabled !== false)
          .map(([platformId]) => platformId)
      : [];
    const estimatedFiles = deploymentPlan.blueprints.reduce((count, item) => {
      const platformCount = isRecord(item.platforms)
        ? Object.values(item.platforms).filter(
            config => isRecord(config) && config.enabled !== false
          ).length
        : 0;
      return count + platformCount;
    }, 0);

    writeStdout('');
    writeStdout(this.colorCyan('📋 Repository Blueprint Preview:'));
    writeStdout(`Title: ${getBlueprintTitle(blueprint)}`);
    writeStdout(`Description: ${blueprint.metadata?.description ?? 'No description'}`);
    writeStdout(`Category: ${blueprint.metadata?.category ?? 'General'}`);
    writeStdout(`Complexity: ${blueprint.metadata?.complexity ?? 'Unknown'}`);
    writeStdout(`Platforms: ${compatiblePlatforms.join(', ') || 'All'}`);
    if (deploymentPlan.blueprints.length > 1) {
      writeStdout(
        `Deployment Set: ${deploymentPlan.blueprints.map(item => getBlueprintTitle(item)).join(', ')}`
      );
    }
    if (deploymentPlan.warnings.length > 0) {
      writeStdout(`Notes: ${deploymentPlan.warnings.join(' | ')}`);
    }
    writeStdout('');
    writeStdout(this.colorPrimary('Run without --preview to deploy'));

    return {
      blueprint: {
        description: blueprint.metadata?.description,
        title: getBlueprintTitle(blueprint),
      },
      projectContext: 'Repository blueprint preview',
      estimatedFiles,
      adaptationPlan: {
        compatibilityScore: 0,
        changes: [],
        warnings: deploymentPlan.warnings,
      },
    };
  }

  async executeRepositoryDeployment(
    blueprint: RepositoryMatch,
    options: DeployCommandOptions
  ): Promise<NoActiveDeploymentResult | V3DeploymentResult> {
    const deploymentPlan = await this.buildRepositoryDeploymentPlan(blueprint, options);
    const canonicalBlueprints = deploymentPlan.blueprints.map(item =>
      this.assertCanonicalRepositoryBlueprint(item)
    );

    return this.executeV3DeploymentPlan(canonicalBlueprints, options, deploymentPlan.warnings);
  }

  assertCanonicalRepositoryBlueprint(blueprint: RepositoryMatch): RepositoryMatch {
    if (!isRecord(blueprint)) {
      throw new Error('Cannot deploy empty blueprint payload');
    }

    if (blueprint.schemaVersion !== '3.0') {
      throw new Error(
        `Canonical deployment requires schemaVersion 3.0, received '${blueprint.schemaVersion ?? 'undefined'}'`
      );
    }

    const rawKind = typeof blueprint.metadata?.kind === 'string' ? blueprint.metadata.kind : '';
    const kind = rawKind.trim().toLowerCase();
    if (!isCanonicalKind(kind)) {
      throw new Error(
        `Canonical deployment requires metadata.kind to be one of: ${Array.from(CANONICAL_KINDS).join(', ')}`
      );
    }

    const platformEntries = isRecord(blueprint.platforms)
      ? Object.entries(blueprint.platforms)
      : [];
    if (platformEntries.length === 0) {
      throw new Error('Canonical deployment requires at least one platform configuration');
    }

    for (const [platformId, config] of platformEntries) {
      if (!isRecord(config) || !isRecord(config.components)) {
        throw new Error(
          `Canonical deployment requires platform '${platformId}' to define a components object`
        );
      }
    }

    return blueprint;
  }

  async executeV3Deployment(
    blueprint: RepositoryMatch,
    options: DeployCommandOptions
  ): Promise<NoActiveDeploymentResult | V3DeploymentResult> {
    return this.executeV3DeploymentPlan([blueprint], options);
  }

  async buildRepositoryDeploymentPlan(
    blueprint: RepositoryMatch,
    options: DeployCommandOptions
  ): Promise<RepositoryDeploymentPlan> {
    const blueprintId = getRepositoryBlueprintId(blueprint);

    if (!blueprintId) {
      return {
        blueprints: [blueprint],
        warnings: [],
      };
    }

    const analyzeBlueprintDependencies = await loadAnalyzeBlueprintDependencies();
    const searchBlueprints = await loadSearchBlueprints();
    const resolved = new Map<string, RepositoryMatch>();
    const resolving = new Set<string>();
    const warnings = new Set<string>();

    const resolveBlueprint = async (current: RepositoryMatch): Promise<void> => {
      const currentId = getRepositoryBlueprintId(current);
      const cacheKey = currentId ?? `inline:${resolved.size}`;

      if (resolved.has(cacheKey)) {
        return;
      }

      if (currentId && resolving.has(currentId)) {
        return;
      }

      if (currentId) {
        resolving.add(currentId);
        try {
          const analysis = normalizeBlueprintDependencyAnalysis(
            await withScopedHubRequestSettings(() => analyzeBlueprintDependencies(currentId))
          );

          if (analysis.dependencies.missing.length > 0) {
            throw new Error(
              `Cannot deploy '${currentId}' because required blueprints are missing from the repository: ${analysis.dependencies.missing.join(', ')}`
            );
          }

          for (const dependency of analysis.dependencies.required) {
            const dependencyId = dependency.id;
            if (!(dependencyId && dependencyId !== currentId)) {
              continue;
            }

            const dependencyResults = normalizeRepositoryMatches(
              await withScopedHubRequestSettings(() =>
                searchBlueprints({
                  exactMatch: true,
                  includeL4: options.includeL4 === true,
                  limit: 10,
                  query: dependencyId,
                })
              )
            );
            const dependencyBlueprint = this.resolveDeterministicRepositoryMatch(
              dependencyResults,
              dependencyId
            );

            if (!dependencyBlueprint) {
              throw new Error(`Required blueprint '${dependencyId}' could not be resolved`);
            }

            warnings.add(
              `Including required blueprint: ${getBlueprintTitle(dependencyBlueprint)} (${dependencyId})`
            );
            await resolveBlueprint(dependencyBlueprint);
          }

          const conflictIds = analysis.conflicts
            .map(conflict => conflict.id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0);
          if (conflictIds.length > 0) {
            warnings.add(
              `${getBlueprintTitle(current)} declares conflicts with: ${conflictIds.join(', ')}`
            );
          }

          const supersededIds = analysis.superseded
            .map(item => item.id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0);
          if (supersededIds.length > 0) {
            warnings.add(`${getBlueprintTitle(current)} supersedes: ${supersededIds.join(', ')}`);
          }
        } finally {
          resolving.delete(currentId);
        }
      }

      resolved.set(cacheKey, current);
    };

    await resolveBlueprint(blueprint);

    return {
      blueprints: [...resolved.values()],
      warnings: [...warnings],
    };
  }

  async executeV3DeploymentPlan(
    blueprints: RepositoryMatch[],
    options: DeployCommandOptions,
    initialWarnings: string[] = []
  ): Promise<NoActiveDeploymentResult | V3DeploymentResult> {
    const projectPath = options.projectPath ?? process.cwd();
    const deploymentLabel =
      blueprints.length === 1
        ? getBlueprintTitle(blueprints[0])
        : `${blueprints.length} blueprints`;

    writeStdout('');
    this.logInfo(
      blueprints.length === 1 ? '📦 Deploying v3.0 blueprint...' : '📦 Deploying v3.0 blueprints...'
    );

    const integrationManager = await loadIntegrationManager(projectPath);

    await integrationManager.discoverIntegrations({ verbose: options.verbose });
    await integrationManager.scanAll({ verbose: options.verbose });

    const activeIntegrations = integrationManager.getActiveIntegrations();
    if (activeIntegrations.length === 0) {
      this.logWarning('No active IDE integrations detected');
      return { success: false, platforms: [] };
    }

    const ruleAdapter = await loadRuleAdapter(projectPath, options.verbose);
    const evaluator = await loadEquivalenceEvaluator();
    const constraintValidator = await loadPlatformConstraintValidator();

    const results: V3DeploymentResult = {
      success: true,
      platforms: [],
      files: [],
      errors: [],
      warnings: [...initialWarnings],
      equivalence: [],
    };
    const appliedPlatforms = new Set<string>();

    for (const blueprint of blueprints) {
      for (const integration of activeIntegrations) {
        const platformId = this.mapIntegrationToPlatformId(integration.name);
        const integrationLabel =
          blueprints.length === 1
            ? integration.name
            : `${integration.name} (${getBlueprintTitle(blueprint)})`;

        if (options.verbose === true) {
          writeStdout(chalk.gray(`Deploying to ${integrationLabel} (${platformId})...`));
        }

        try {
          const equivalence = evaluator.evaluateBlueprintForPlatform(blueprint, platformId);
          results.equivalence.push({
            platform: integrationLabel,
            ...equivalence,
          });

          if (equivalence.outcome === 'unsupported') {
            results.warnings.push(...evaluator.toWarningMessages(equivalence, integrationLabel));
            continue;
          }

          if (equivalence.outcome === 'lossy') {
            results.warnings.push(...evaluator.toWarningMessages(equivalence, integrationLabel));
          }

          const adaptResult = await ruleAdapter.adaptFromBlueprint(blueprint, platformId, {
            overwrite: options.overwrite,
          });

          if (adaptResult.success === false) {
            results.warnings.push(
              ...(Array.isArray(adaptResult.warnings) ? adaptResult.warnings : [])
            );
            continue;
          }

          if (Array.isArray(adaptResult.files) && adaptResult.files.length > 0) {
            const enforcedFiles = this.enforcePlatformConstraints(
              adaptResult.files,
              platformId,
              constraintValidator,
              results.warnings,
              integrationLabel
            );
            const writeResult = await this.writeAdaptedFiles(enforcedFiles, options);
            results.files.push(...writeResult.files);

            if (writeResult.errors.length === 0) {
              appliedPlatforms.add(integration.name);
            } else {
              results.success = false;

              if (writeResult.files.length > 0) {
                results.warnings.push(
                  `${integrationLabel}: wrote ${writeResult.files.length} of ${adaptResult.files.length} file(s)`
                );
              }

              results.errors.push(
                ...writeResult.errors.map(error => ({
                  platform: integrationLabel,
                  error: error.error,
                }))
              );
            }
          }

          if (Array.isArray(adaptResult.warnings)) {
            results.warnings.push(...adaptResult.warnings);
          }
        } catch (error) {
          results.success = false;
          results.errors.push({
            platform: integrationLabel,
            error: getErrorMessage(error),
          });
        }
      }
    }

    results.platforms = [...appliedPlatforms];

    writeStdout('');
    if (results.files.length === 0) {
      // No artifacts were committed to disk. This is a no-op/failure, not a
      // success — surface why (errors, or every platform unsupported/skipped).
      results.success = false;
      const reason =
        results.errors.length > 0
          ? 'all writes failed'
          : results.equivalence.some(item => item.outcome === 'unsupported') &&
              !results.equivalence.some(item => item.outcome !== 'unsupported')
            ? 'no target platform can represent this blueprint (unsupported)'
            : 'no artifacts were produced for the active platforms';
      this.logError(`❌ Deployment wrote 0 files: ${deploymentLabel} (${reason})`);
    } else if (results.errors.length === 0) {
      this.logSuccess(`✅ Deployed: ${deploymentLabel}`);
    } else {
      this.logWarning(`⚠️  Deployment completed with errors: ${deploymentLabel}`);
    }
    this.logInfo(`🚀 Applied to: ${results.platforms.join(', ') || 'none'}`);
    this.logInfo(`📝 Files created: ${results.files.length}`);

    const equivalenceCounts = { lossless: 0, lossy: 0, unsupported: 0 };
    for (const item of results.equivalence) {
      if (item.outcome === 'lossless') {
        equivalenceCounts.lossless += 1;
      } else if (item.outcome === 'lossy') {
        equivalenceCounts.lossy += 1;
      } else if (item.outcome === 'unsupported') {
        equivalenceCounts.unsupported += 1;
      }
    }

    this.logInfo(
      `🧮 Equivalence: ${equivalenceCounts.lossless} lossless, ${equivalenceCounts.lossy} lossy, ${equivalenceCounts.unsupported} unsupported`
    );

    if (results.warnings.length > 0) {
      writeStdout('');
      writeStdout(chalk.yellow('Warnings:'));
      for (const warning of results.warnings) {
        writeStdout(chalk.yellow(`  ⚠️  ${warning}`));
      }
    }

    if (results.errors.length > 0) {
      writeStdout('');
      writeStdout(chalk.red('Errors:'));
      for (const error of results.errors) {
        writeStdout(chalk.red(`  ✗ ${error.platform}: ${error.error}`));
      }
    }

    return results;
  }

  /**
   * Enforce per-platform character limits on adapted files as the single
   * source of constraint truth (delegates to PlatformConstraintValidator).
   * Truncates oversized content and records a warning for each adjustment.
   */
  enforcePlatformConstraints(
    files: AdaptedFile[],
    platformId: string,
    constraintValidator: PlatformConstraintValidatorInstance,
    warnings: string[],
    label: string
  ): AdaptedFile[] {
    if (constraintValidator.getMaxCharsForPlatform(platformId) === null) {
      return files;
    }

    return files.map(file => {
      const enforcement = constraintValidator.enforceCharLimit(file.content, platformId, {
        mode: 'truncate',
      });

      if (enforcement.enforced && enforcement.warning) {
        warnings.push(`${label}: ${enforcement.warning}`);
      }

      return enforcement.truncated ? { ...file, content: enforcement.content } : file;
    });
  }

  async writeAdaptedFiles(
    files: AdaptedFile[],
    options: DeployCommandOptions
  ): Promise<PlatformWriteResult> {
    const writtenFiles: AdaptedFile[] = [];
    const errors: Array<{ error: string; path: string }> = [];

    for (const file of files) {
      try {
        await fs.mkdir(path.dirname(file.path), { recursive: true });
        await writeFileAtomic(file.path, file.content);
        writtenFiles.push(file);

        if (options.verbose === true) {
          writeStdout(chalk.green(`  ✓ ${path.relative(process.cwd(), file.path)}`));
        }
      } catch (error) {
        const errorMessage = `Failed to write ${file.path}: ${getErrorMessage(error)}`;
        errors.push({
          path: file.path,
          error: errorMessage,
        });

        if (options.verbose === true) {
          writeStderr(chalk.red(`  ✗ ${errorMessage}`));
        }
      }
    }

    return {
      files: writtenFiles,
      errors,
    };
  }

  mapIntegrationToPlatformId(integrationName: string): string {
    const mapping: Record<string, string> = {
      'Claude Code CLI': 'claude-code',
      'Claude Desktop': 'claude-desktop',
      Cursor: 'cursor',
      Windsurf: 'windsurf',
      'Windsurf Next': 'windsurf-next',
      'GitHub Copilot': 'github-copilot',
      'VS Code': 'vscode',
      'VS Code Insiders': 'vscode-insiders',
      VSCodium: 'vscodium',
      Continue: 'continue',
      Aider: 'aider',
      'OpenAI Codex': 'openai-codex',
      Codex: 'openai-codex',
      OpenCode: 'opencode',
      'Gemini CLI': 'gemini-cli',
      Gemini: 'gemini-cli',
      Cline: 'cline',
      'Roo Code': 'roo-code',
      Goose: 'goose',
      Junie: 'junie',
      'Google Antigravity': 'google-antigravity',
      'Kimi CLI': 'kimi-cli',
      'Mistral Vibe': 'mistral-vibe',
      Trae: 'trae',
      'JetBrains AI': 'jetbrains-ai',
      'Zed Editor': 'zed',
      Zed: 'zed',
      Tabnine: 'tabnine',
      ACP: 'acp',
    };

    return mapping[integrationName] ?? integrationName.toLowerCase().replaceAll(/\s+/g, '-');
  }
}
