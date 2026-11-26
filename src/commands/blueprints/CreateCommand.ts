/**
 * CreateCommand
 * -----------------------
 * Create a new blueprint with canonical AI Context Schema v3 structure.
 * Supports both interactive and non-interactive modes.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';
import matter from 'gray-matter';

import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

const DEFAULT_KIND = 'conditional-rule';

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

type ComplexityLevel = 'complex' | 'medium' | 'simple';
type ImpactScope = 'component' | 'feature' | 'file' | 'project' | 'system';
type MaturityLevel = 'beta' | 'deprecated' | 'experimental' | 'stable';
type TargetAudience = 'any' | 'architect' | 'developer' | 'junior' | 'senior' | 'team-lead';

type SupportedPlatformId =
  | 'aider'
  | 'claude-code'
  | 'continue'
  | 'cursor'
  | 'gemini-cli'
  | 'github-copilot'
  | 'jetbrains'
  | 'openai-codex'
  | 'tabnine'
  | 'windsurf'
  | 'zed';

type CreateCommandOptions = {
  audience?: TargetAudience;
  author?: string;
  category?: string;
  complexity?: ComplexityLevel;
  description?: string;
  interactive?: boolean;
  kind?: CanonicalKind;
  maturity?: MaturityLevel;
  name?: string;
  output?: string;
  scope?: ImpactScope;
  tags?: string[];
  title?: string;
};

type CanonicalPlatformComponent = {
  enabled: boolean;
  format?: string;
  location: string;
  manifests?: never[];
  type: string;
};

type CanonicalPlatformConfig = {
  components: Record<string, CanonicalPlatformComponent>;
  enabled?: boolean;
};

type CanonicalPlatformMap = Record<string, CanonicalPlatformConfig>;

type BlueprintFormData = {
  audience: TargetAudience;
  author?: string;
  category: string;
  complexity: ComplexityLevel;
  description: string;
  kind: CanonicalKind;
  maturity: MaturityLevel;
  name: string;
  platforms: CanonicalPlatformMap;
  scope: ImpactScope;
  tags: string[];
  title: string;
};

type BlueprintFrontmatter = {
  audience: TargetAudience;
  author?: string;
  category: string;
  complexity: ComplexityLevel;
  created: string;
  description: string;
  id: string;
  kind: CanonicalKind;
  lastUpdated: string;
  maturity: MaturityLevel;
  platforms: CanonicalPlatformMap;
  schemaVersion: '3.0';
  scope: ImpactScope;
  tags: string[];
  title: string;
  version: string;
};

type PromptModule = typeof import('@clack/prompts');

function createCanonicalPlatformConfig(platformId: SupportedPlatformId): CanonicalPlatformConfig {
  switch (platformId) {
    case 'claude-code':
      return {
        components: {
          main: {
            type: 'claude-main',
            location: 'CLAUDE.md',
            enabled: true,
          },
        },
      };
    case 'cursor':
      return {
        components: {
          rules: {
            type: 'cursor-rule',
            location: '.cursor/rules/',
            enabled: true,
            format: 'mdc',
          },
        },
      };
    case 'windsurf':
      return {
        components: {
          rules: {
            type: 'windsurf-rule',
            location: '.windsurf/rules/',
            enabled: true,
          },
        },
      };
    case 'github-copilot':
      return {
        components: {
          'repo-level': {
            type: 'copilot-repo',
            location: '.github/copilot-instructions.md',
            enabled: true,
          },
        },
      };
    case 'openai-codex':
      return {
        components: {
          agents: {
            type: 'agents-md',
            location: 'AGENTS.md',
            enabled: true,
          },
        },
      };
    case 'gemini-cli':
      return {
        components: {
          main: {
            type: 'gemini-main',
            location: 'GEMINI.md',
            enabled: true,
          },
        },
      };
    case 'continue':
      return {
        components: {
          config: {
            type: 'continue-config',
            location: '~/.continue/config.yaml',
            enabled: true,
          },
        },
      };
    case 'aider':
      return {
        components: {
          config: {
            type: 'aider-config',
            location: '.aider.conf.yml',
            enabled: true,
          },
        },
      };
    case 'tabnine':
      return {
        components: {
          guidelines: {
            type: 'tabnine-guideline',
            location: '.tabnine/guidelines/',
            enabled: true,
          },
        },
      };
    case 'zed':
      return {
        components: {
          settings: {
            type: 'zed-settings',
            location: '~/.config/zed/settings.json',
            enabled: true,
          },
        },
      };
    case 'jetbrains':
      return {
        components: {
          aiignore: {
            type: 'aiignore',
            location: '.aiignore',
            enabled: true,
          },
        },
      };
  }
}

function buildCanonicalPlatforms(
  platformIds?: readonly SupportedPlatformId[]
): CanonicalPlatformMap {
  const selectedPlatforms =
    Array.isArray(platformIds) && platformIds.length > 0
      ? platformIds
      : (['claude-code', 'cursor', 'windsurf'] as const);

  const platforms: CanonicalPlatformMap = {};
  for (const platformId of selectedPlatforms) {
    platforms[platformId] = createCanonicalPlatformConfig(platformId);
  }

  return platforms;
}

async function loadPromptModule(): Promise<PromptModule> {
  return import('@clack/prompts');
}

async function resolvePromptValue<T>(
  prompts: PromptModule,
  pendingValue: Promise<T | symbol>,
  cancelMessage = 'Blueprint creation cancelled.'
): Promise<T> {
  const value = await pendingValue;
  if (prompts.isCancel(value)) {
    prompts.cancel(cancelMessage);
    throw new Error(cancelMessage);
  }

  return value;
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, content, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export class CreateCommand extends BaseCommand {
  constructor() {
    super('create', 'Create a new blueprint with canonical AI Context Schema v3 structure');
  }

  configureOptions(command: Command): Command {
    return command
      .option('-n, --name <name>', 'Blueprint name')
      .option('-t, --title <title>', 'Blueprint title')
      .option('-d, --description <description>', 'Blueprint description')
      .option(
        '--kind <kind>',
        'Canonical kind (project-memory, conditional-rule, skill, command, workflow, agent, hook, mcp-integration, plugin-distribution)',
        DEFAULT_KIND
      )
      .option('-c, --category <category>', 'Blueprint category', 'tool')
      .option('-a, --author <author>', 'Blueprint author')
      .option('--tags <tags...>', 'Blueprint tags (space-separated)')
      .option('--complexity <level>', 'Complexity level (simple, medium, complex)', 'medium')
      .option(
        '--scope <scope>',
        'Impact scope (file, component, feature, project, system)',
        'project'
      )
      .option(
        '--audience <audience>',
        'Target audience (developer, architect, team-lead, junior, senior, any)',
        'developer'
      )
      .option(
        '--maturity <level>',
        'Maturity level (experimental, beta, stable, deprecated)',
        'beta'
      )
      .option('-o, --output <path>', 'Output file path', './.vdk/blueprints/rules')
      .option('--interactive', 'Interactive blueprint creation', false);
  }

  async execute(
    options: CreateCommandOptions
  ): Promise<{ blueprintData: BlueprintFormData; filePath: string; success: true }> {
    await commandContext.initialize();
    this.showHeader();

    try {
      const blueprintData =
        options.interactive === true
          ? await this.createInteractive()
          : this.createFromOptions(options);

      const filePath = await this.writeBlueprintFile(
        blueprintData,
        options.output ?? './.vdk/blueprints/rules'
      );

      this.logSuccess(`Blueprint created: ${this.formatPath(filePath)}`);
      this.logInfo(
        `Run ${this.colorPrimary(`vdk validate --file ${filePath}`)} to validate the blueprint`
      );

      this.trackSuccess({
        blueprintName: blueprintData.name,
        interactive: options.interactive === true,
        category: blueprintData.category,
      });

      return { success: true, filePath, blueprintData };
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(String(error));
      this.exitWithError(`Blueprint creation failed: ${commandError.message}`, commandError);
    }
  }

  async createInteractive(): Promise<BlueprintFormData> {
    const prompts = await loadPromptModule();

    const name = await resolvePromptValue<string>(
      prompts,
      prompts.text({
        message: 'Blueprint name (kebab-case):',
        placeholder: 'my-awesome-blueprint',
        validate: (value: string | undefined) => {
          if (!value) {
            return 'Name is required';
          }

          if (!/^[a-z0-9-]+$/.test(value)) {
            return 'Name must be kebab-case (lowercase letters, numbers, and hyphens only)';
          }

          return undefined;
        },
      })
    );

    const title = await resolvePromptValue<string>(
      prompts,
      prompts.text({
        message: 'Blueprint title:',
        placeholder: 'My Awesome Blueprint',
      })
    );

    const description = await resolvePromptValue<string>(
      prompts,
      prompts.text({
        message: 'Description:',
        placeholder: 'A brief description of what this blueprint does',
      })
    );

    const category = await resolvePromptValue<string>(
      prompts,
      prompts.select<string>({
        message: 'Category:',
        options: [
          { value: 'core', label: 'Core' },
          { value: 'language', label: 'Language' },
          { value: 'technology', label: 'Technology' },
          { value: 'stack', label: 'Stack' },
          { value: 'task', label: 'Task' },
          { value: 'assistant', label: 'Assistant' },
          { value: 'tool', label: 'Tool' },
          { value: 'project', label: 'Project' },
          { value: 'agent-system', label: 'Agent System' },
          { value: 'command', label: 'Command' },
          { value: 'skill', label: 'Skill' },
          { value: 'workflow', label: 'Workflow' },
          { value: 'rule', label: 'Rule' },
          { value: 'plugin', label: 'Plugin' },
        ],
      })
    );

    const kind = await resolvePromptValue(
      prompts,
      prompts.select<CanonicalKind>({
        message: 'Canonical kind:',
        initialValue: DEFAULT_KIND,
        options: [
          { value: 'project-memory', label: 'project-memory' },
          { value: 'conditional-rule', label: 'conditional-rule' },
          { value: 'skill', label: 'skill' },
          { value: 'command', label: 'command' },
          { value: 'workflow', label: 'workflow' },
          { value: 'agent', label: 'agent' },
          { value: 'hook', label: 'hook' },
          { value: 'mcp-integration', label: 'mcp-integration' },
          { value: 'plugin-distribution', label: 'plugin-distribution' },
        ],
      })
    );

    const complexity = await resolvePromptValue(
      prompts,
      prompts.select<ComplexityLevel>({
        message: 'Complexity level:',
        options: [
          { value: 'simple', label: 'Simple' },
          { value: 'medium', label: 'Medium' },
          { value: 'complex', label: 'Complex' },
        ],
      })
    );

    const scope = await resolvePromptValue(
      prompts,
      prompts.select<ImpactScope>({
        message: 'Impact scope:',
        options: [
          { value: 'file', label: 'File' },
          { value: 'component', label: 'Component' },
          { value: 'feature', label: 'Feature' },
          { value: 'project', label: 'Project' },
          { value: 'system', label: 'System' },
        ],
      })
    );

    const audience = await resolvePromptValue(
      prompts,
      prompts.select<TargetAudience>({
        message: 'Target audience:',
        options: [
          { value: 'developer', label: 'Developer' },
          { value: 'architect', label: 'Architect' },
          { value: 'team-lead', label: 'Team Lead' },
          { value: 'junior', label: 'Junior' },
          { value: 'senior', label: 'Senior' },
          { value: 'any', label: 'Any' },
        ],
      })
    );

    const maturity = await resolvePromptValue(
      prompts,
      prompts.select<MaturityLevel>({
        message: 'Maturity level:',
        options: [
          { value: 'experimental', label: 'Experimental' },
          { value: 'beta', label: 'Beta' },
          { value: 'stable', label: 'Stable' },
          { value: 'deprecated', label: 'Deprecated' },
        ],
      })
    );

    const tagsInput = await resolvePromptValue<string>(
      prompts,
      prompts.text({
        message: 'Tags (comma-separated):',
        placeholder: 'javascript, react, typescript',
      })
    );

    const author = await resolvePromptValue<string>(
      prompts,
      prompts.text({
        message: 'Author:',
        placeholder: 'Your name or organization',
      })
    );

    const addPlatforms = await resolvePromptValue(
      prompts,
      prompts.confirm({
        message: 'Configure platform-specific settings?',
        initialValue: false,
      })
    );

    let platforms = buildCanonicalPlatforms();
    if (addPlatforms) {
      const selectedPlatforms = await resolvePromptValue(
        prompts,
        prompts.multiselect<SupportedPlatformId>({
          message: 'Select target platforms:',
          options: [
            { value: 'claude-code', label: 'Claude Code' },
            { value: 'cursor', label: 'Cursor' },
            { value: 'windsurf', label: 'Windsurf' },
            { value: 'github-copilot', label: 'GitHub Copilot' },
            { value: 'openai-codex', label: 'OpenAI Codex' },
            { value: 'gemini-cli', label: 'Gemini CLI' },
            { value: 'continue', label: 'Continue' },
            { value: 'aider', label: 'Aider' },
            { value: 'tabnine', label: 'Tabnine' },
            { value: 'zed', label: 'Zed' },
            { value: 'jetbrains', label: 'JetBrains' },
          ],
        })
      );
      platforms = buildCanonicalPlatforms(selectedPlatforms);
    }

    return {
      name,
      title: title.trim().length > 0 ? title : name,
      description:
        description.trim().length > 0
          ? description
          : `${title.trim().length > 0 ? title : name} blueprint`,
      category,
      kind,
      complexity,
      scope,
      audience,
      maturity,
      author: author.trim().length > 0 ? author : undefined,
      tags:
        tagsInput.trim().length > 0
          ? tagsInput
              .split(',')
              .map(tag => tag.trim().toLowerCase())
              .filter(tag => tag.length > 0)
          : [],
      platforms,
    };
  }

  createFromOptions(options: CreateCommandOptions): BlueprintFormData {
    if (typeof options.name !== 'string' || options.name.trim().length === 0) {
      this.exitWithError('Blueprint name is required. Use --name or --interactive.');
    }

    const blueprintName = options.name.trim();
    const blueprintTitle =
      typeof options.title === 'string' && options.title.trim().length > 0
        ? options.title.trim()
        : blueprintName;

    return {
      name: blueprintName,
      title: blueprintTitle,
      description:
        typeof options.description === 'string' && options.description.trim().length > 0
          ? options.description.trim()
          : `${blueprintTitle} blueprint`,
      kind: options.kind ?? DEFAULT_KIND,
      category: options.category ?? 'tool',
      complexity: options.complexity ?? 'medium',
      scope: options.scope ?? 'project',
      audience: options.audience ?? 'developer',
      maturity: options.maturity ?? 'beta',
      author:
        typeof options.author === 'string' && options.author.trim().length > 0
          ? options.author.trim()
          : undefined,
      tags: Array.isArray(options.tags)
        ? options.tags.map(tag => tag.trim()).filter(tag => tag.length > 0)
        : [],
      platforms: buildCanonicalPlatforms(),
    };
  }

  generateBlueprintContent(blueprintData: BlueprintFormData): string {
    const now = new Date().toISOString().split('T')[0] ?? new Date().toISOString();

    const frontmatter: BlueprintFrontmatter = {
      schemaVersion: '3.0',
      id: blueprintData.name,
      title: blueprintData.title,
      description: blueprintData.description,
      version: '1.0.0',
      kind: blueprintData.kind,
      category: blueprintData.category,
      complexity: blueprintData.complexity,
      scope: blueprintData.scope,
      audience: blueprintData.audience,
      maturity: blueprintData.maturity,
      author: blueprintData.author,
      tags: blueprintData.tags,
      created: now,
      lastUpdated: now,
      platforms: blueprintData.platforms,
    };

    const body = `# ${frontmatter.title}

## Description

${frontmatter.description}

## Implementation

Add your implementation details here...

## Usage

Describe how to use this blueprint...

## Examples

Provide examples of the blueprint in action...

---

*Generated with VDK CLI - AI Context Schema v3.0*
`;

    return matter.stringify(body, frontmatter);
  }

  async writeBlueprintFile(blueprintData: BlueprintFormData, outputPath: string): Promise<string> {
    const resolvedOutputPath = path.resolve(outputPath);
    await fs.mkdir(resolvedOutputPath, { recursive: true });

    const filePath = path.join(resolvedOutputPath, `${blueprintData.name}.mdc`);
    const content = this.generateBlueprintContent(blueprintData);
    await writeFileAtomic(filePath, content);

    return filePath;
  }
}
