/**
 * Unified Migration Command
 * ------------------------
 * Consolidated migration command that routes to appropriate migration strategies
 * based on the task type and detected context.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';

import { BaseCommand, type CommandOptions, type ValidationRules } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type MigrationStrategy = 'auto' | 'context' | 'detect' | 'platform' | 'schema';

type UnifiedMigrateCommandOptions = CommandOptions & {
  clean?: boolean;
  deploy?: boolean;
  dryRun?: boolean;
  force?: boolean;
  outputPath?: string;
  preview?: boolean;
  projectPath?: string;
  schemaVersion?: string;
  source?: string;
  sourcePath?: string;
  target?: string;
  type?: MigrationStrategy;
  verbose?: boolean;
};

type NormalizedUnifiedMigrateOptions = {
  clean: boolean;
  deploy: boolean;
  dryRun: boolean;
  force: boolean;
  outputPath: string;
  preview: boolean;
  projectPath: string;
  schemaVersion: string;
  source?: string;
  sourcePath?: string;
  target?: string;
  type: MigrationStrategy;
  verbose: boolean;
};

type PlatformMigrationFileResult = {
  lossInfo: number;
  outputPath: string;
  semanticScore: number;
  sourcePath: string;
};

type NormalizedPlatformMigrationResult = {
  deployed: number;
  dryRun: boolean;
  files: PlatformMigrationFileResult[];
  filesConverted: number;
  source: string;
  success: boolean;
  target: string;
  type: 'platform';
};

type SchemaMigratorOptions = {
  force?: boolean;
  verbose?: boolean;
};

type SchemaMigrator = {
  findBlueprintFiles: (inputPath: string) => Promise<string[]>;
  migrateBlueprints: (
    inputPath: string,
    outputPath: string,
    options?: SchemaMigratorOptions
  ) => Promise<{
    errors: number;
    migrated: number;
    processed: number;
    skipped: number;
  }>;
};

type SchemaMigratorModule = {
  SchemaV3Migrator: new (options?: SchemaMigratorOptions) => SchemaMigrator;
};

type AutoMigrationPreview = {
  adaptations: string[];
  platforms: string[];
  rules: Array<{
    adaptations: string[];
    confidence: string;
    file: string;
    type: string;
  }>;
  summary: string;
  warnings: string[];
};

type AutoMigratorResult = {
  backupId?: string | null;
  platformsDeployed?: string[];
  preview?: AutoMigrationPreview;
  reason?: string;
  rulesProcessed?: number;
  success: boolean;
  suggestions?: {
    improvements?: string[];
    nextSteps?: string[];
    publishWorthy?: boolean;
  };
};

type AutoMigrator = {
  migrate: (options: {
    clean?: boolean;
    force?: boolean;
    preview?: boolean;
    verbose?: boolean;
  }) => Promise<AutoMigratorResult>;
};

type AutoMigratorModule = {
  AutoMigrator: new (projectPath: string) => AutoMigrator;
};

type ProjectScanEntry = {
  modifiedTime?: string;
  name: string;
  path?: string;
  relativePath: string;
  size?: number;
  type?: string;
};

type ProjectScanResult = {
  directories?: ProjectScanEntry[];
  files?: ProjectScanEntry[];
};

type ProjectScanner = {
  scanProject: (projectPath: string) => ProjectScanResult | Promise<ProjectScanResult>;
};

type ProjectScannerModule = {
  ProjectScanner: new (options?: { projectPath?: string; verbose?: boolean }) => ProjectScanner;
};

type DetectedContext = {
  confidence?: string;
  filePath?: string;
  relativePath?: string;
  source?: string;
  type?: string;
};

type MigrationDetector = {
  detectAIContexts: (
    projectData: ProjectScanResult
  ) => DetectedContext[] | Promise<DetectedContext[]>;
};

type MigrationDetectorModule = {
  MigrationDetector: new (projectPath?: unknown) => MigrationDetector;
};

type MigrationManagerResults = {
  converted: DetectedContext[];
  deployed: {
    failed?: unknown[];
    integrations?: string[];
    successful?: unknown[];
  };
  detected: DetectedContext[];
  failed: Array<{
    context?: DetectedContext;
    error: string;
  }>;
  generated: Array<{
    id?: string;
    path?: string;
    type?: string;
  }>;
  skipped: Array<{
    context?: DetectedContext;
    reason: string;
  }>;
};

type MigrationManager = {
  migrate: (options: { deployToIdes: boolean; dryRun: boolean }) => object | Promise<object>;
};

type MigrationManagerModule = {
  MigrationManager: new (options?: {
    outputPath?: string;
    projectPath?: string;
    verbose?: boolean;
  }) => MigrationManager;
};

type NormalizedSchemaMigrationResult = {
  dryRun: boolean;
  errors: number;
  filesFound: number;
  migrated: number;
  processed: number;
  skipped: number;
  success: boolean;
  targetVersion?: string;
  type: 'schema';
};

type NormalizedAutoMigrationResult = {
  dryRun: boolean;
  platformsDeployed: number;
  previewSummary?: string;
  reason?: string;
  rulesFound: number;
  success: boolean;
  suggestions: string[];
  type: 'auto';
};

type NormalizedContextMigrationResult = {
  contextsConverted: number;
  contextsFound: number;
  dryRun: boolean;
  failedConversions: number;
  ideIntegrations: number;
  rulesGenerated: number;
  success: boolean;
  type: 'context';
};

type NormalizedMigrationResult =
  | NormalizedAutoMigrationResult
  | NormalizedContextMigrationResult
  | NormalizedPlatformMigrationResult
  | NormalizedSchemaMigrationResult;

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

type PlatformConversionResult = {
  content: string;
  filePath: string;
  lossInfo?: unknown[];
  semanticScore?: number;
};

type UniversalFormatConverterInstance = {
  convertViaIR: (input: {
    content: string;
    filePath: string;
    targetOptions?: Record<string, unknown>;
    targetPlatform: string;
  }) => Promise<unknown>;
};

type UniversalFormatConverterModule = {
  UniversalFormatConverter: new () => UniversalFormatConverterInstance;
};

function normalizePlatformConversion(value: unknown): PlatformConversionResult {
  if (!isRecord(value)) {
    throw new Error('Conversion returned an invalid result');
  }

  if (typeof value.content !== 'string' || typeof value.filePath !== 'string') {
    throw new Error('Conversion result is missing content or filePath');
  }

  return {
    content: value.content,
    filePath: value.filePath,
    lossInfo: Array.isArray(value.lossInfo) ? value.lossInfo : [],
    semanticScore: typeof value.semanticScore === 'number' ? value.semanticScore : 100,
  };
}

// Canonical platform ids accepted by the IR conversion pipeline.
const PLATFORM_SELECTOR_ALIASES: Record<string, string> = {
  cursor: 'cursor',
  'claude-code': 'claude-code',
  'claude-code-cli': 'claude-code',
  claude: 'claude-code',
  windsurf: 'windsurf',
  'github-copilot': 'github-copilot',
  copilot: 'github-copilot',
  continue: 'continue',
  aider: 'aider',
  'openai-codex': 'openai-codex',
  codex: 'openai-codex',
  'gemini-cli': 'gemini-cli',
  gemini: 'gemini-cli',
  zed: 'zed',
  tabnine: 'tabnine',
  'jetbrains-ai': 'jetbrains',
  jetbrains: 'jetbrains',
};

function normalizePlatformSelector(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return PLATFORM_SELECTOR_ALIASES[value.trim().toLowerCase()] ?? null;
}

// Standard source-artifact globs per source platform.
function sourcePlatformGlobs(platform: string): string[] {
  const globs: Record<string, string[]> = {
    cursor: ['.cursor/rules/**/*.mdc', '.cursorrules'],
    'claude-code': ['CLAUDE.md', '.claude/rules/**/*.md', '.claude/commands/**/*.md'],
    windsurf: ['.windsurf/rules/**/*.md', '.windsurfrules', '.windsurf/workflows/**/*.yaml'],
    'github-copilot': ['.github/copilot-instructions.md', '.github/copilot/**/*.md'],
    continue: ['.continue/**/*.{json,yaml}'],
    aider: ['.aider.conf.yml', '.aiderignore'],
    'openai-codex': ['AGENTS.md', '.agents/**/*.md'],
    'gemini-cli': ['GEMINI.md', '.gemini/context/**/*.md'],
    zed: ['.zed/**/*.json'],
    tabnine: ['.tabnine/guidelines/**/*.md'],
    jetbrains: ['.idea/ai-rules/**/*.md'],
  };

  return globs[platform] ?? [];
}

// Detect a Cursor tab-trigger declaration (e.g. an `@react-component` trigger in
// frontmatter or body) used as a shorthand invocation in Cursor.
function extractCursorTabTrigger(content: string): string | null {
  // Frontmatter form: `trigger: react-component` or `tabTrigger: react-component`
  const frontmatterMatch = content.match(/^\s*(?:tab[-_]?trigger|trigger)\s*:\s*@?([\w-]+)/im);
  if (frontmatterMatch) {
    return frontmatterMatch[1];
  }

  // Body form: a leading `@react-component` token on its own line.
  const bodyMatch = content.match(/(?:^|\n)\s*@([a-z][\w-]+)\b/i);
  if (bodyMatch) {
    return bodyMatch[1];
  }

  return null;
}

// Convert a Cursor tab-trigger rule into a Claude slash-command markdown doc.
function convertTriggerToSlashCommand(trigger: string, sourceContent: string): string {
  const body = sourceContent.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return [
    '---',
    `description: ${trigger} command (migrated from Cursor @${trigger} trigger)`,
    '---',
    '',
    `# /${trigger}`,
    '',
    body || `Run the ${trigger} workflow.`,
    '',
  ].join('\n');
}

function normalizeOptions(options: UnifiedMigrateCommandOptions): NormalizedUnifiedMigrateOptions {
  return {
    clean: options.clean === true,
    deploy: options.deploy !== false,
    dryRun: options.dryRun === true,
    force: options.force === true,
    outputPath: path.resolve(options.outputPath ?? './.vdk/blueprints/rules'),
    preview: options.preview === true,
    projectPath: path.resolve(options.projectPath ?? process.cwd()),
    schemaVersion: options.schemaVersion ?? '3.0.0',
    // `source` is now a PLATFORM selector (cursor, claude-code, windsurf, …).
    source: typeof options.source === 'string' ? options.source.trim() : undefined,
    // Filesystem path for platform migration (defaults to projectPath).
    sourcePath: options.sourcePath
      ? path.resolve(options.sourcePath)
      : path.resolve(options.projectPath ?? process.cwd()),
    target: typeof options.target === 'string' ? options.target.trim() : undefined,
    type: options.type ?? 'detect',
    verbose: options.verbose === true,
  };
}

function getDetectedContexts(value: unknown): DetectedContext[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map(entry => ({
    confidence: typeof entry.confidence === 'string' ? entry.confidence : undefined,
    filePath: typeof entry.filePath === 'string' ? entry.filePath : undefined,
    relativePath: typeof entry.relativePath === 'string' ? entry.relativePath : undefined,
    source: typeof entry.source === 'string' ? entry.source : undefined,
    type: typeof entry.type === 'string' ? entry.type : undefined,
  }));
}

function getGeneratedResults(value: unknown): Array<{
  id?: string;
  path?: string;
  type?: string;
}> {
  return Array.isArray(value)
    ? value.filter(isRecord).map(entry => ({
        id: typeof entry.id === 'string' ? entry.id : undefined,
        path: typeof entry.path === 'string' ? entry.path : undefined,
        type: typeof entry.type === 'string' ? entry.type : undefined,
      }))
    : [];
}

function getFailures(value: unknown): Array<{
  context?: DetectedContext;
  error: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map(entry => ({
    context: isRecord(entry.context)
      ? {
          confidence:
            typeof entry.context.confidence === 'string' ? entry.context.confidence : undefined,
          filePath: typeof entry.context.filePath === 'string' ? entry.context.filePath : undefined,
          relativePath:
            typeof entry.context.relativePath === 'string' ? entry.context.relativePath : undefined,
          source: typeof entry.context.source === 'string' ? entry.context.source : undefined,
          type: typeof entry.context.type === 'string' ? entry.context.type : undefined,
        }
      : undefined,
    error: typeof entry.error === 'string' ? entry.error : 'Unknown migration failure',
  }));
}

function normalizeMigrationManagerResults(value: unknown): MigrationManagerResults {
  if (!isRecord(value)) {
    return {
      converted: [],
      deployed: {},
      detected: [],
      failed: [],
      generated: [],
      skipped: [],
    };
  }

  const deployed = isRecord(value.deployed) ? value.deployed : {};

  return {
    converted: getDetectedContexts(value.converted),
    deployed: {
      failed: Array.isArray(deployed.failed) ? deployed.failed : [],
      integrations: Array.isArray(deployed.integrations)
        ? deployed.integrations.filter((entry): entry is string => typeof entry === 'string')
        : [],
      successful: Array.isArray(deployed.successful) ? deployed.successful : [],
    },
    detected: getDetectedContexts(value.detected),
    failed: getFailures(value.failed),
    generated: getGeneratedResults(value.generated),
    skipped: getFailures(value.skipped).map(entry => ({
      context: entry.context,
      reason: entry.error,
    })),
  };
}

async function loadSchemaMigrator(options: SchemaMigratorOptions): Promise<SchemaMigrator> {
  const migrationModule: SchemaMigratorModule =
    await import('../../migration/converters/schema-v3-migrator.js');

  return new migrationModule.SchemaV3Migrator(options);
}

export class UnifiedMigrateCommand extends BaseCommand {
  constructor() {
    super('migrate', 'Migrate existing AI contexts and rules to VDK format');
  }

  configureOptions(command: Command): Command {
    return command
      .option('-p, --projectPath <path>', 'Path to the project to scan', process.cwd())
      .option(
        '-o, --outputPath <path>',
        'Path where VDK rule artifacts should be saved',
        './.vdk/blueprints/rules'
      )
      .option(
        '--type <type>',
        'Migration type: auto, schema, context, platform, or detect (default)',
        'detect'
      )
      .option(
        '--source <platform>',
        'Source platform to migrate FROM (cursor, claude-code, windsurf, …)'
      )
      .option(
        '--target <platform>',
        'Target platform to migrate TO (cursor, claude-code, windsurf, …)'
      )
      .option('--source-path <path>', 'Filesystem path to read source artifacts from')
      .option('--schema-version <version>', 'Target schema version for schema migration', '3.0.0')
      .option('--dry-run', 'Preview migration without creating files', false)
      .option('--preview', 'Alias for --dry-run', false)
      .option('--force', 'Force migration even if files already exist', false)
      .option('--clean', 'Remove import files after successful migration', false)
      .option('--no-deploy', 'Skip deployment to IDE integrations')
      .option('-v, --verbose', 'Enable verbose output', false);
  }

  getValidationRules(): ValidationRules {
    return {
      defaults: {
        clean: false,
        deploy: true,
        dryRun: false,
        force: false,
        outputPath: './.vdk/blueprints/rules',
        projectPath: process.cwd(),
        schemaVersion: '3.0.0',
        type: 'detect',
        verbose: false,
      },
      fields: {
        outputPath: {
          pathType: 'writeable',
          type: 'string',
        },
        projectPath: {
          pathType: 'directory',
          type: 'string',
        },
        schemaVersion: {
          format: 'semver',
          type: 'string',
        },
        source: {
          // `source` is now a platform selector, not a path.
          type: 'string',
        },
        sourcePath: {
          pathType: 'directory',
          type: 'string',
        },
        target: {
          type: 'string',
        },
        type: {
          enum: ['auto', 'schema', 'context', 'platform', 'detect'],
          type: 'string',
        },
      },
      crossValidation: rawOptions => {
        const errors: string[] = [];

        if (rawOptions.dryRun === true && rawOptions.clean === true) {
          errors.push('Cannot use --clean with --dry-run (dry run does not modify files)');
        }

        if (rawOptions.dryRun === true && rawOptions.deploy !== false) {
          errors.push('Cannot deploy during dry run (use --no-deploy or remove --dry-run)');
        }

        // Platform → platform migration requires both endpoints.
        const isPlatformMigration =
          rawOptions.type === 'platform' ||
          (typeof rawOptions.source === 'string' && typeof rawOptions.target === 'string');

        if (isPlatformMigration) {
          if (typeof rawOptions.source !== 'string' || rawOptions.source.trim().length === 0) {
            errors.push('Platform migration requires --source <platform>');
          }
          if (typeof rawOptions.target !== 'string' || rawOptions.target.trim().length === 0) {
            errors.push('Platform migration requires --target <platform>');
          }
        }

        return errors.length > 0 ? errors : true;
      },
    };
  }

  async execute(options: UnifiedMigrateCommandOptions): Promise<{
    result: NormalizedMigrationResult;
    strategy: Exclude<MigrationStrategy, 'detect'>;
    success: boolean;
  }> {
    await commandContext.initialize();
    this.showHeader();

    if (options.preview) {
      options.dryRun = true;
    }

    if (options.dryRun && options.deploy !== false) {
      options.deploy = false;
      if (options.verbose) {
        this.logInfo('Dry-run mode detected: deployment automatically disabled');
      }
    }

    await this.validateOptions(options, this.getValidationRules());

    const normalizedOptions = normalizeOptions(options);

    try {
      const strategy = await this.determineMigrationStrategy(normalizedOptions);

      if (normalizedOptions.verbose) {
        this.logInfo(`Using migration strategy: ${strategy}`);
      }

      const result = await this.executeStrategy(strategy, normalizedOptions);
      this.displayMigrationResults(result);
      this.trackSuccess({
        ...result,
        strategy,
      });

      return {
        result,
        strategy,
        success: result.success,
      };
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));

      if (/no\s+rules\s+found|no\s+migration\s+targets\s+found/i.test(commandError.message)) {
        writeStdout('No rules found');
      }

      this.exitWithError(`Migration failed: ${commandError.message}`, commandError);
    }
  }

  async determineMigrationStrategy(
    options: NormalizedUnifiedMigrateOptions
  ): Promise<Exclude<MigrationStrategy, 'detect'>> {
    // Explicit platform→platform selectors always take precedence.
    if (
      typeof options.source === 'string' &&
      options.source.length > 0 &&
      typeof options.target === 'string' &&
      options.target.length > 0
    ) {
      return 'platform';
    }

    if (options.type !== 'detect') {
      return options.type;
    }

    const spinner = this.createSpinner('Analyzing migration requirements...');
    spinner.start();

    try {
      const importPath = path.join(options.projectPath, '.vdk', 'migrate');
      const hasImportedFiles = await this.checkDirectory(importPath);
      const hasExistingRules = await this.checkDirectory(options.outputPath);

      const migrationDetectorModule: MigrationDetectorModule =
        await import('../../migration/core/migration-detector.js');
      const projectScannerModule: ProjectScannerModule =
        await import('../../scanner/core/ProjectScanner.js');

      const detector = new migrationDetectorModule.MigrationDetector(options.projectPath);
      const scanner = new projectScannerModule.ProjectScanner({
        projectPath: options.projectPath,
        verbose: false,
      });
      const projectData = await Promise.resolve(scanner.scanProject(options.projectPath));
      const contexts = await Promise.resolve(detector.detectAIContexts(projectData));

      spinner.stop();

      if (hasImportedFiles) {
        this.logInfo('Found imported AI rules - using auto migration');
        return 'auto';
      }

      if (hasExistingRules) {
        this.logInfo('Found existing VDK rules - using schema migration');
        return 'schema';
      }

      if (contexts.length > 0) {
        this.logInfo(`Found ${contexts.length} AI contexts - using context migration`);
        return 'context';
      }

      this.logWarning('No migration targets found');
      return 'context';
    } catch (error) {
      spinner.fail('Analysis failed');
      throw error;
    }
  }

  async executeStrategy(
    strategy: Exclude<MigrationStrategy, 'detect'>,
    options: NormalizedUnifiedMigrateOptions
  ): Promise<NormalizedMigrationResult> {
    switch (strategy) {
      case 'auto':
        return this.executeAutoMigration(options);
      case 'schema':
        return this.executeSchemaMigration(options);
      case 'context':
        return this.executeContextMigration(options);
      case 'platform':
        return this.executePlatformMigration(options);
      default:
        throw new Error(`Unknown migration strategy: ${String(strategy)}`);
    }
  }

  async executeAutoMigration(
    options: NormalizedUnifiedMigrateOptions
  ): Promise<NormalizedAutoMigrationResult> {
    const migrationModule: AutoMigratorModule = await import('../../migration/AutoMigrator.js');
    const migrator = new migrationModule.AutoMigrator(options.projectPath);
    const result = await migrator.migrate({
      clean: options.clean,
      force: options.force,
      preview: options.dryRun,
      verbose: options.verbose,
    });

    if (options.dryRun) {
      return {
        dryRun: true,
        platformsDeployed: result.preview?.platforms.length ?? 0,
        previewSummary: result.preview?.summary,
        reason: result.reason,
        rulesFound: result.preview?.rules.length ?? 0,
        success: result.success,
        suggestions: result.preview?.warnings ?? [],
        type: 'auto',
      };
    }

    return {
      dryRun: false,
      platformsDeployed: result.platformsDeployed?.length ?? 0,
      reason: result.reason,
      rulesFound: result.rulesProcessed ?? 0,
      success: result.success,
      suggestions: result.suggestions?.nextSteps ?? [],
      type: 'auto',
    };
  }

  async executeSchemaMigration(
    options: NormalizedUnifiedMigrateOptions
  ): Promise<NormalizedSchemaMigrationResult> {
    const migrator = await loadSchemaMigrator({ verbose: options.verbose });
    const inputPath = options.sourcePath ?? options.outputPath;

    if (options.dryRun) {
      const files = await migrator.findBlueprintFiles(inputPath);
      return {
        dryRun: true,
        errors: 0,
        filesFound: files.length,
        migrated: 0,
        processed: 0,
        skipped: 0,
        success: true,
        targetVersion: options.schemaVersion,
        type: 'schema',
      };
    }

    const results = await migrator.migrateBlueprints(inputPath, options.outputPath, {
      force: options.force,
      verbose: options.verbose,
    });

    return {
      dryRun: false,
      errors: results.errors,
      filesFound: results.processed,
      migrated: results.migrated,
      processed: results.processed,
      skipped: results.skipped,
      success: results.errors === 0,
      targetVersion: options.schemaVersion,
      type: 'schema',
    };
  }

  async executeContextMigration(
    options: NormalizedUnifiedMigrateOptions
  ): Promise<NormalizedContextMigrationResult> {
    const migrationModule: MigrationManagerModule =
      await import('../../migration/migration-manager.js');
    const migrationManager = new migrationModule.MigrationManager({
      outputPath: options.outputPath,
      projectPath: options.projectPath,
      verbose: options.verbose,
    });

    const rawResults = await Promise.resolve(
      migrationManager.migrate({
        deployToIdes: options.deploy,
        dryRun: options.dryRun,
      })
    );
    const results = normalizeMigrationManagerResults(rawResults);

    return {
      contextsConverted: results.converted.length,
      contextsFound: results.detected.length,
      dryRun: options.dryRun,
      failedConversions: results.failed.length,
      ideIntegrations: results.deployed.successful?.length ?? 0,
      rulesGenerated: results.generated.length,
      success: results.failed.length === 0,
      type: 'context',
    };
  }

  /**
   * Platform → platform migration. Reads the source platform's native artifacts
   * (e.g. .cursor/rules/*.mdc, .cursorrules), converts each to canonical IR, and
   * deploys the result as the TARGET platform's real files (e.g. .claude/CLAUDE.md,
   * .claude/rules/*, .claude/commands/*). Cursor tab triggers (@trigger) are
   * converted to Claude slash commands (/trigger) when targeting claude-code.
   */
  async executePlatformMigration(
    options: NormalizedUnifiedMigrateOptions
  ): Promise<NormalizedPlatformMigrationResult> {
    const sourcePlatform = normalizePlatformSelector(options.source);
    const targetPlatform = normalizePlatformSelector(options.target);
    const projectRoot = options.sourcePath ?? options.projectPath;

    if (!sourcePlatform) {
      throw new Error(`Unknown source platform: ${String(options.source)}`);
    }
    if (!targetPlatform) {
      throw new Error(`Unknown target platform: ${String(options.target)}`);
    }
    if (sourcePlatform === targetPlatform) {
      throw new Error('Source and target platforms must differ');
    }

    const { glob } = await import('glob');
    const converterModule: UniversalFormatConverterModule =
      await import('../../publishing/UniversalFormatConverter.js');
    const converter = new converterModule.UniversalFormatConverter();

    const patterns = sourcePlatformGlobs(sourcePlatform);
    const matchedPaths = new Set<string>();
    for (const pattern of patterns) {
      const files = await glob(pattern, {
        cwd: projectRoot,
        absolute: true,
        nodir: true,
        dot: true,
      });
      for (const file of files) {
        matchedPaths.add(file);
      }
    }

    const sourceFiles = [...matchedPaths];

    if (sourceFiles.length === 0) {
      this.logWarning(
        `No ${sourcePlatform} artifacts found under ${projectRoot} (looked for: ${patterns.join(', ')})`
      );
      return {
        deployed: 0,
        dryRun: options.dryRun,
        files: [],
        filesConverted: 0,
        source: sourcePlatform,
        success: false,
        target: targetPlatform,
        type: 'platform',
      };
    }

    const results: PlatformMigrationFileResult[] = [];
    let deployed = 0;

    for (const sourceFile of sourceFiles) {
      try {
        const content = await fs.readFile(sourceFile, 'utf8');

        const conversion = normalizePlatformConversion(
          await converter.convertViaIR({
            content,
            filePath: sourceFile,
            targetPlatform,
            targetOptions: { sourcePlatform, targetPlatform },
          })
        );

        let outputContent = conversion.content;
        let relativeOutputPath = conversion.filePath;

        // Cursor tab-trigger (@react-component) → Claude slash command
        // (/react-component) deployed at .claude/commands/react-component.md.
        if (sourcePlatform === 'cursor' && targetPlatform === 'claude-code') {
          const trigger = extractCursorTabTrigger(content);
          if (trigger) {
            relativeOutputPath = path.join('.claude', 'commands', `${trigger}.md`);
            outputContent = convertTriggerToSlashCommand(trigger, content);
          }
        }

        const outputPath = path.isAbsolute(relativeOutputPath)
          ? relativeOutputPath
          : path.join(options.projectPath, relativeOutputPath);

        const lossInfo = conversion.lossInfo?.length ?? 0;

        if (!options.dryRun) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, outputContent, 'utf8');
          deployed += 1;
        }

        results.push({
          lossInfo,
          outputPath,
          semanticScore: conversion.semanticScore ?? 100,
          sourcePath: sourceFile,
        });

        if (options.verbose) {
          this.logInfo(
            `${options.dryRun ? '[dry-run] ' : ''}${path.relative(options.projectPath, sourceFile)} → ${path.relative(options.projectPath, outputPath)}`
          );
        }
      } catch (error) {
        this.logWarning(`Failed to migrate ${sourceFile}: ${getErrorMessage(error)}`);
      }
    }

    return {
      deployed,
      dryRun: options.dryRun,
      files: results,
      filesConverted: results.length,
      source: sourcePlatform,
      success: results.length > 0,
      target: targetPlatform,
      type: 'platform',
    };
  }

  async checkDirectory(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        return false;
      }

      const files = await fs.readdir(dirPath);
      return files.length > 0;
    } catch {
      return false;
    }
  }

  displayMigrationResults(result: NormalizedMigrationResult): void {
    if (result.dryRun) {
      this.logInfo('Migration Preview:');
    } else if (result.success) {
      this.logSuccess('Migration complete');
    } else {
      this.logWarning('Migration completed with issues');
    }

    switch (result.type) {
      case 'schema':
        if (result.dryRun) {
          this.logInfo(`Found ${result.filesFound} files for schema migration`);
          if (result.targetVersion) {
            this.logInfo(`Target version: ${result.targetVersion}`);
          }
        } else {
          this.logInfo(`Processed: ${result.processed}`);
          this.logInfo(`Migrated: ${result.migrated}`);
          this.logInfo(`Skipped: ${result.skipped}`);
          this.logInfo(`Errors: ${result.errors}`);
        }
        break;

      case 'auto':
        this.logInfo(`Found ${result.rulesFound} imported rule files`);
        this.logInfo(`Target platforms: ${result.platformsDeployed}`);
        if (result.previewSummary) {
          this.logInfo(result.previewSummary);
        }
        if (result.reason) {
          this.logWarning(`Migration note: ${result.reason}`);
        }
        for (const suggestion of result.suggestions) {
          this.logInfo(suggestion);
        }
        break;

      case 'context':
        this.logInfo(`Found ${result.contextsFound} AI contexts`);
        this.logInfo(`Converted ${result.contextsConverted} contexts`);
        this.logInfo(`Generated ${result.rulesGenerated} VDK rules`);
        this.logInfo(`Configured ${result.ideIntegrations} IDE integrations`);
        if (result.failedConversions > 0) {
          this.logWarning(`Failed conversions: ${result.failedConversions}`);
        }
        break;

      case 'platform': {
        this.logInfo(`Source platform: ${result.source}`);
        this.logInfo(`Target platform: ${result.target}`);
        this.logInfo(`Files converted: ${result.filesConverted}`);
        if (!result.dryRun) {
          this.logInfo(`Files deployed: ${result.deployed}`);
        }
        const lossy = result.files.filter(file => file.lossInfo > 0).length;
        const avgScore = result.files.length
          ? Math.round(
              result.files.reduce((sum, file) => sum + file.semanticScore, 0) / result.files.length
            )
          : 100;
        // Round-trip semantic equivalence summary (item 4 wiring).
        this.logInfo(
          `Semantic equivalence: ${avgScore}% avg (${lossy} file(s) with conversion loss)`
        );
        break;
      }
    }

    if (!result.dryRun && result.success) {
      writeStdout('');
      this.logInfo('Next steps:');
      this.logInfo('Run "vdk status" to verify the migration');
      this.logInfo('Use "vdk sync" to get additional blueprints');
      this.logInfo('Try "vdk validate" to check rule quality');
    }
  }
}
