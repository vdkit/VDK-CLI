/**
 * MigrateCommand
 * -----------------------
 * Migrates v2.x blueprints to v3.0 component architecture.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';

import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type CommandArgumentOptions = {
  args?: unknown[];
  dryRun?: boolean;
  output?: string;
  verbose?: boolean;
};

type JsonObject = Record<string, unknown>;

type ValidationResult = {
  errors: string[];
  valid: boolean;
};

type SchemaValidatorModule = {
  validateBlueprint: (blueprint: JsonObject) => Promise<ValidationResult>;
};

type LegacyBlueprint = JsonObject & {
  category?: string;
  description?: string;
  id?: string;
  metadata?: JsonObject & {
    category?: string;
    description?: string;
    id?: string;
    title?: string;
  };
  platforms?: Record<string, PlatformSourceConfig>;
  schemaVersion?: string;
  title?: string;
  version?: string;
};

type PlatformSourceConfig = JsonObject & {
  agents?: ManifestSource[];
  commands?: ManifestSource[];
  files?: ManifestSource[];
  rules?: ManifestSource[];
  skills?: ManifestSource[];
};

type ManifestSource = JsonObject | string;

type PlatformManifest = JsonObject & {
  file?: string;
  name?: string;
};

type PlatformComponent = {
  enabled: true;
  manifests: PlatformManifest[];
};

type V3PlatformConfig = JsonObject & {
  components: {
    agents?: PlatformComponent;
    commands?: PlatformComponent;
    rules?: PlatformComponent;
    skills?: PlatformComponent;
  };
  enabled: true;
};

type CanonicalKind =
  | 'agent'
  | 'command'
  | 'conditional-rule'
  | 'project-memory'
  | 'skill'
  | 'workflow';

type V3Blueprint = JsonObject & {
  category: string;
  description: string;
  id: string;
  kind: CanonicalKind;
  metadata: JsonObject & {
    created: string;
    originalVersion: string;
    source: 'vdk-migrate';
  };
  platforms: Record<string, V3PlatformConfig>;
  schemaVersion: '3.0';
  title: string;
  version: string;
};

const KNOWN_PLATFORMS = [
  'claude-code',
  'cursor',
  'windsurf',
  'github-copilot',
  'continue',
  'aider',
  'openai-codex',
  'gemini-cli',
] as const;

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
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

function parseBlueprintJson(content: string): LegacyBlueprint {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error('Blueprint file must contain a JSON object');
  }

  return parsed;
}

function normalizeManifestEntry(entry: ManifestSource): PlatformManifest {
  if (typeof entry === 'string') {
    return {
      file: entry,
      name: path.basename(entry, path.extname(entry)),
    };
  }

  return {
    ...entry,
    file: typeof entry.file === 'string' ? entry.file : undefined,
    name:
      typeof entry.name === 'string'
        ? entry.name
        : typeof entry.file === 'string'
          ? path.basename(entry.file, path.extname(entry.file))
          : undefined,
  };
}

function buildComponentEntries(
  entries: ManifestSource[] | undefined
): PlatformComponent | undefined {
  if (!Array.isArray(entries) || entries.length === 0) {
    return undefined;
  }

  return {
    enabled: true,
    manifests: entries.map(normalizeManifestEntry),
  };
}

async function loadSchemaValidator(): Promise<SchemaValidatorModule> {
  return import('../../utils/schema-validator.js');
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, content, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export class MigrateCommand extends BaseCommand {
  constructor() {
    super('migrate-blueprint', 'Migrate a single v2.x JSON blueprint file to the v3.0 schema');
  }

  configureOptions(command: Command): Command {
    return command
      .argument('<file>', 'Path to the blueprint file (json)')
      .option('-o, --output <path>', 'Output path (defaults to overwriting input)')
      .option('-d, --dry-run', 'Preview migration without saving', false)
      .option('-v, --verbose', 'Enable verbose output', false);
  }

  async execute(options: CommandArgumentOptions): Promise<void> {
    await commandContext.initialize();
    this.showHeader();

    const filePath = this.getInputFilePath(options);
    const absolutePath = path.resolve(process.cwd(), filePath);

    try {
      if (options.verbose === true) {
        this.logInfo(`Reading blueprint: ${absolutePath}`);
      }

      const content = await fs.readFile(absolutePath, 'utf8');
      const blueprint = parseBlueprintJson(content);

      if (blueprint.schemaVersion === '3.0') {
        this.logSuccess('Blueprint is already v3.0 compliant.');
        return;
      }

      this.logInfo(`Migrating blueprint from v${blueprint.schemaVersion ?? '2.x'} to v3.0...`);

      const migratedBlueprint = this.migrateToV3(blueprint);
      const validation = await this.validateMigratedBlueprint(migratedBlueprint);

      if (!validation.valid) {
        this.logWarning('Migrated blueprint has validation issues:');
        for (const error of validation.errors) {
          writeStdout(`  - ${error}`);
        }

        if (options.dryRun !== true) {
          this.logInfo(
            'Proceeding with save despite validation warnings (manual fixes may still be required).'
          );
        }
      } else {
        this.logSuccess('Migrated blueprint is valid v3.0.');
      }

      if (options.dryRun === true) {
        writeStdout('');
        writeStdout('--- Preview ---');
        writeStdout(JSON.stringify(migratedBlueprint, null, 2));
        writeStdout('---------------');
        this.logInfo('Dry run complete. No changes written.');
        return;
      }

      const outputPath =
        typeof options.output === 'string'
          ? path.resolve(process.cwd(), options.output)
          : absolutePath;

      await writeFileAtomic(outputPath, JSON.stringify(migratedBlueprint, null, 2));
      this.logSuccess(`Blueprint migrated and saved to: ${outputPath}`);
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError(`Migration failed: ${commandError.message}`, commandError);
    }
  }

  getInputFilePath(options: CommandArgumentOptions): string {
    const inputValue = Array.isArray(options.args) ? options.args[0] : undefined;
    if (typeof inputValue !== 'string' || inputValue.trim().length === 0) {
      this.exitWithError('Migration requires a blueprint file path.');
    }

    return inputValue;
  }

  async validateMigratedBlueprint(blueprint: JsonObject): Promise<ValidationResult> {
    const schemaValidator = await loadSchemaValidator();
    return schemaValidator.validateBlueprint(blueprint);
  }

  migrateToV3(blueprint: LegacyBlueprint): V3Blueprint {
    const platforms: Record<string, V3PlatformConfig> = {};
    const sourcePlatforms = isRecord(blueprint.platforms) ? blueprint.platforms : {};

    for (const platform of KNOWN_PLATFORMS) {
      const sourceConfig = sourcePlatforms[platform];
      if (isRecord(sourceConfig)) {
        platforms[platform] = this.migratePlatformConfig(sourceConfig);
      }
    }

    const category =
      typeof blueprint.category === 'string'
        ? blueprint.category
        : typeof blueprint.metadata?.category === 'string'
          ? blueprint.metadata.category
          : 'General';

    return {
      schemaVersion: '3.0',
      kind: this.deriveCanonicalKind(category, sourcePlatforms),
      id:
        typeof blueprint.id === 'string'
          ? blueprint.id
          : typeof blueprint.metadata?.id === 'string'
            ? blueprint.metadata.id
            : 'unknown-id',
      version: typeof blueprint.version === 'string' ? blueprint.version : '1.0.0',
      title:
        typeof blueprint.title === 'string'
          ? blueprint.title
          : typeof blueprint.metadata?.title === 'string'
            ? blueprint.metadata.title
            : 'Untitled',
      description:
        typeof blueprint.description === 'string'
          ? blueprint.description
          : typeof blueprint.metadata?.description === 'string'
            ? blueprint.metadata.description
            : '',
      category:
        typeof blueprint.category === 'string'
          ? blueprint.category
          : typeof blueprint.metadata?.category === 'string'
            ? blueprint.metadata.category
            : 'General',
      metadata: {
        ...(isRecord(blueprint.metadata) ? blueprint.metadata : {}),
        created: new Date().toISOString(),
        source: 'vdk-migrate',
        originalVersion:
          typeof blueprint.schemaVersion === 'string' ? blueprint.schemaVersion : '2.x',
      },
      platforms,
    };
  }

  migratePlatformConfig(config: PlatformSourceConfig): V3PlatformConfig {
    const rules = buildComponentEntries(
      Array.isArray(config.rules)
        ? config.rules
        : Array.isArray(config.files)
          ? config.files
          : undefined
    );
    const agents = buildComponentEntries(config.agents);
    const commands = buildComponentEntries(config.commands);
    const skills = buildComponentEntries(config.skills);

    const {
      agents: _agents,
      commands: _commands,
      files: _files,
      rules: _rules,
      skills: _skills,
      ...otherConfig
    } = config;

    return {
      ...otherConfig,
      enabled: true,
      components: {
        ...(rules ? { rules } : {}),
        ...(agents ? { agents } : {}),
        ...(commands ? { commands } : {}),
        ...(skills ? { skills } : {}),
      },
    };
  }

  /**
   * Derive the canonical v3 `kind` from the legacy category and the component
   * types declared across platforms. The v3 schema requires a single canonical
   * kind; v2 blueprints only carried a free-form `category`.
   */
  deriveCanonicalKind(
    category: string,
    sourcePlatforms: Record<string, PlatformSourceConfig>
  ): CanonicalKind {
    const normalizedCategory = category.toLowerCase();

    // Category-based mapping (most reliable signal from v2 blueprints).
    const categoryMap: Record<string, CanonicalKind> = {
      assistant: 'agent',
      assistants: 'agent',
      agent: 'agent',
      agents: 'agent',
      command: 'command',
      commands: 'command',
      task: 'command',
      skill: 'skill',
      skills: 'skill',
      workflow: 'workflow',
      workflows: 'workflow',
      core: 'project-memory',
      memory: 'project-memory',
    };

    if (categoryMap[normalizedCategory]) {
      return categoryMap[normalizedCategory];
    }

    // Fall back to inspecting declared component types across platforms.
    const hasComponent = (key: keyof PlatformSourceConfig): boolean =>
      Object.values(sourcePlatforms).some(
        config => isRecord(config) && Array.isArray(config[key]) && config[key].length > 0
      );

    if (hasComponent('agents')) return 'agent';
    if (hasComponent('commands')) return 'command';
    if (hasComponent('skills')) return 'skill';

    // Default: technology/language/stack rules become conditional-rule.
    return 'conditional-rule';
  }
}
