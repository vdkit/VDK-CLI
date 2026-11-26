/**
 * GenerateCommand
 * ---------------
 * Handles 'vdk generate' command - Generate platform-specific AI context files.
 * Creates Claude agents, Cursor rules, Copilot instructions, etc.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';

import { createIR, validateIR } from '../../ir/types.js';
import { RuleGenerator } from '../../scanner/core/RuleGenerator.js';
import { BaseCommand, type ValidationRules } from '../base/BaseCommand.js';

type ComponentType = 'agent' | 'command' | 'main' | 'rule' | 'skill' | 'workflow';
type SupportedPlatform = 'claude-code' | 'cursor' | 'github-copilot' | 'windsurf';
type TemplateLevel = 'comprehensive' | 'minimal' | 'standard';

type GenerateCommandOptions = {
  description?: string;
  dryRun?: boolean;
  globs?: string[];
  name?: string;
  output?: string;
  platform?: SupportedPlatform;
  template?: TemplateLevel;
  triggers?: string[];
  type?: ComponentType;
  verbose?: boolean;
};

type ContentSection = {
  content: string;
  level: number;
  title: string;
};

type GeneratedIR = ReturnType<typeof createIR>;

type ValidationResponse = {
  errors: string[];
  valid: boolean;
};

type GeneratedPlatformFile = {
  content: string;
  filePath: string;
  fullPath?: string;
};

type RuleGeneratorAdapter = {
  generateFromIR: (ir: GeneratedIR, options: GenerateCommandOptions) => GeneratedPlatformFile;
};

type PlatformSupportResult =
  | {
      supported: true;
    }
  | {
      alternative: string;
      message: string;
      supported: false;
    };

type TemplateDefinition = {
  content: string;
  sections: ContentSection[];
};

type TemplateLibrary = Record<ComponentType, Record<TemplateLevel, TemplateDefinition>>;

type GenerateCommandResult = {
  filePath: string;
  ir: GeneratedIR;
  platform: SupportedPlatform;
  success: boolean;
  type: ComponentType;
};

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getObjectProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return Reflect.get(value, key);
}

export class GenerateCommand extends BaseCommand {
  private readonly generator: InstanceType<typeof RuleGenerator>;

  constructor() {
    super('generate', 'Generate platform-specific AI context files');
    this.generator = new RuleGenerator('./.vdk/blueprints/rules', 'default', false, {
      verbose: false,
    });
  }

  configureOptions(command: Command): Command {
    return command
      .option('-t, --type <type>', 'Component type: agent, rule, command, skill, workflow')
      .option('-n, --name <name>', 'Component name')
      .option('-p, --platform <platform>', 'Target platform', 'claude-code')
      .option('-d, --description <desc>', 'Component description')
      .option('-g, --globs <patterns...>', 'Glob patterns for conditional activation')
      .option('--triggers <triggers...>', 'Trigger strings for commands')
      .option(
        '--template <template>',
        'Use a template: minimal, standard, comprehensive',
        'standard'
      )
      .option('-o, --output <path>', 'Output directory')
      .option('--dry-run', 'Preview without writing files', false)
      .option('-v, --verbose', 'Enable verbose output', false);
  }

  getValidationRules(): ValidationRules {
    return {
      defaults: {
        platform: 'claude-code',
        template: 'standard',
        dryRun: false,
        verbose: false,
      },
      fields: {
        type: {
          type: 'string',
          enum: ['agent', 'rule', 'command', 'skill', 'workflow', 'main'],
        },
        platform: {
          type: 'string',
          enum: ['claude-code', 'cursor', 'github-copilot', 'windsurf'],
        },
        template: {
          type: 'string',
          enum: ['minimal', 'standard', 'comprehensive'],
        },
      },
    };
  }

  async execute(
    options: GenerateCommandOptions
  ): Promise<GenerateCommandResult | { success: false }> {
    this.showHeader();
    await this.validateOptions(options, this.getValidationRules());

    this.generator.verbose = options.verbose === true;

    if (!options.type) {
      this.logError('Component type is required. Use --type <type>');
      this.showGenerateHelp();
      return { success: false };
    }

    if (!options.name) {
      this.logError('Component name is required. Use --name <name>');
      return { success: false };
    }

    const platform = options.platform ?? 'claude-code';
    const supportCheck = this.checkPlatformSupport(platform, options.type);
    if (!supportCheck.supported) {
      this.logWarning(supportCheck.message);
      this.logInfo(`💡 ${supportCheck.alternative}`);
    }

    const spinner = this.createSpinner(`Generating ${options.type} for ${platform}...`);
    spinner.start();

    try {
      const ir = this.createIRFromOptions({
        ...options,
        name: options.name,
        platform,
        type: options.type,
      });

      const validation: ValidationResponse = validateIR(ir);
      if (!validation.valid) {
        spinner.warn('Generated IR has validation warnings');
        for (const error of validation.errors) {
          this.logWarning(`  ⚠️ ${error}`);
        }
      }

      const result = await this.generateForPlatform(ir, {
        ...options,
        name: options.name,
        platform,
        type: options.type,
      });

      spinner.succeed(`Generated ${options.type}: ${options.name}`);

      if (options.dryRun) {
        this.logInfo('\n📄 [DRY RUN] Would create:');
        this.logInfo(`   Path: ${result.filePath}`);
        this.logInfo('   Content:');
        writeStdout('---');
        writeStdout(result.content);
        writeStdout('---');
      } else {
        this.logSuccess(`Created: ${this.formatPath(result.filePath)}`);
      }

      return {
        success: true,
        type: options.type,
        platform,
        filePath: result.filePath,
        ir,
      };
    } catch (error) {
      spinner.fail('Generation failed');
      this.logError(getErrorMessage(error));
      return { success: false };
    }
  }

  createIRFromOptions(
    options: Required<Pick<GenerateCommandOptions, 'name' | 'type'>> & GenerateCommandOptions
  ): GeneratedIR {
    const ir: GeneratedIR = createIR(options.type, options.name);
    const description = options.description ?? `${options.name} ${options.type}`;

    ir.description = description;

    const template = this.getTemplate(
      options.type,
      options.template ?? 'standard',
      options.name,
      description
    );
    ir.content = {
      raw: template.content,
      format: 'markdown',
      sections: template.sections,
      hasFrontmatter: false,
    };

    if (options.triggers) {
      ir.triggers = options.triggers;
    }

    if (options.globs) {
      ir.conditionalRules = {
        globs: options.globs,
        activation: 'path-based',
      };
    }

    return ir;
  }

  getTemplate(
    type: ComponentType,
    templateLevel: TemplateLevel,
    name: string,
    description: string
  ): TemplateDefinition {
    const templates: TemplateLibrary = {
      agent: {
        minimal: {
          content:
            '# Agent: {{name}}\n\nThis agent helps with specific tasks.\n\n## Behavior\n\n- Focus on the assigned task\n- Ask for clarification when needed',
          sections: [{ title: 'Agent', level: 1, content: '' }],
        },
        standard: {
          content:
            '# Agent: {{name}}\n\n{{description}}\n\n## Capabilities\n\n- PROACTIVELY identify relevant tasks\n- Use available tools effectively\n- Maintain context across interactions\n\n## Behavior Guidelines\n\n- Always explain your reasoning\n- Ask for clarification on ambiguous requests\n- Provide examples when helpful\n\n## Tools\n\n- Read: Access file contents\n- Edit: Modify files\n- Search: Find relevant code',
          sections: [
            { title: 'Agent', level: 1, content: '' },
            { title: 'Capabilities', level: 2, content: '' },
            { title: 'Behavior Guidelines', level: 2, content: '' },
            { title: 'Tools', level: 2, content: '' },
          ],
        },
        comprehensive: {
          content:
            '# Agent: {{name}}\n\n{{description}}\n\n## Purpose\n\nThis agent specializes in [specific domain].\n\n## Capabilities\n\n- PROACTIVELY identify and address relevant tasks\n- Use all available tools effectively\n- Maintain comprehensive context\n- Learn from interactions\n\n## Behavior Guidelines\n\n### Communication\n- Be clear and concise\n- Explain reasoning step-by-step\n- Ask clarifying questions\n\n### Problem Solving\n- Break down complex problems\n- Consider multiple approaches\n- Validate solutions\n\n## Tools\n\n- **Read**: Access file contents\n- **Edit**: Modify files with precision\n- **Search**: Find relevant code and patterns\n- **Bash**: Execute commands when needed\n\n## Constraints\n\n- Always respect project conventions\n- Never modify without understanding impact\n- Escalate uncertain decisions',
          sections: [],
        },
      },
      rule: {
        minimal: {
          content: '# {{name}}\n\n{{description}}',
          sections: [],
        },
        standard: {
          content:
            '# {{name}}\n\n{{description}}\n\n## Guidelines\n\n- Follow project conventions\n- Maintain code quality\n\n## Examples\n\n```text\n// Example code\n```',
          sections: [],
        },
        comprehensive: {
          content:
            '# {{name}}\n\n{{description}}\n\n## Overview\n\nThese guidelines ensure consistency and quality.\n\n## Guidelines\n\n### Must Do\n- Follow established patterns\n- Write clear documentation\n- Add appropriate tests\n\n### Must Avoid\n- Introducing breaking changes without migration\n- Skipping error handling\n- Ignoring type safety\n\n## Examples\n\n### Good Example\n```text\n// Good pattern\n```\n\n### Bad Example\n```text\n// Avoid this pattern\n```',
          sections: [],
        },
      },
      command: {
        minimal: {
          content: '# Command: {{name}}\n\nTrigger: /{{name}}\n\n{{description}}',
          sections: [],
        },
        standard: {
          content:
            '---\ntriggers:\n  - /{{name}}\n---\n\n# Command: {{name}}\n\n{{description}}\n\n## Usage\n\n`/{{name}} [arguments]`\n\n## Behavior\n\nWhen triggered, this command will:\n1. Parse arguments\n2. Execute the action\n3. Report results',
          sections: [],
        },
        comprehensive: {
          content:
            '---\ntriggers:\n  - /{{name}}\n  - /{{name}}-alt\ntools:\n  - Read\n  - Edit\n  - Bash\n---\n\n# Command: {{name}}\n\n{{description}}\n\n## Usage\n\n`/{{name}} [options] [arguments]`\n\n### Options\n\n- `--flag`: Description\n- `--param <value>`: Description\n\n## Behavior\n\n1. **Input Validation**: Verify arguments\n2. **Execution**: Perform the action\n3. **Output**: Report results\n\n## Examples\n\n```text\n/{{name}} --flag argument\n```',
          sections: [],
        },
      },
      skill: {
        minimal: {
          content: '# Skill: {{name}}\n\n{{description}}',
          sections: [],
        },
        standard: {
          content:
            '# Skill: {{name}}\n\n{{description}}\n\n## Capabilities\n\nThis skill enables:\n- Capability 1\n- Capability 2\n\n## Usage\n\nApply this skill when dealing with [context].',
          sections: [],
        },
        comprehensive: {
          content:
            '# Skill: {{name}}\n\n{{description}}\n\n## Overview\n\nThis skill provides expertise in [domain].\n\n## Capabilities\n\n- **Primary**: Main capability\n- **Secondary**: Supporting capability\n\n## When to Apply\n\n- Context 1\n- Context 2\n\n## Examples\n\n### Example 1\n\n[Description]\n\n### Example 2\n\n[Description]',
          sections: [],
        },
      },
      workflow: {
        minimal: {
          content:
            '# Workflow: {{name}}\n\n{{description}}\n\n## Steps\n\n1. Step one\n2. Step two',
          sections: [],
        },
        standard: {
          content:
            '# Workflow: {{name}}\n\n{{description}}\n\n## Prerequisites\n\n- Prerequisite 1\n\n## Steps\n\n### Step 1: [Title]\n\n[Description]\n\n### Step 2: [Title]\n\n[Description]\n\n## Verification\n\n- Check result 1\n- Check result 2',
          sections: [],
        },
        comprehensive: {
          content:
            '---\nname: {{name}}\ndescription: {{description}}\ntriggers:\n  - manual\n---\n\n# Workflow: {{name}}\n\n{{description}}\n\n## Prerequisites\n\n- [ ] Prerequisite 1\n- [ ] Prerequisite 2\n\n## Steps\n\n### Step 1: [Title]\n\n**Purpose**: [Why this step]\n\n**Actions**:\n1. Action 1\n2. Action 2\n\n**Verification**: [How to verify]\n\n### Step 2: [Title]\n\n**Purpose**: [Why this step]\n\n**Actions**:\n1. Action 1\n2. Action 2\n\n**Verification**: [How to verify]\n\n## Rollback\n\nIf something goes wrong:\n1. Rollback step 1\n2. Rollback step 2',
          sections: [],
        },
      },
      main: {
        minimal: {
          content: '# {{name}}\n\n{{description}}',
          sections: [],
        },
        standard: {
          content: '# {{name}}\n\n{{description}}',
          sections: [],
        },
        comprehensive: {
          content: '# {{name}}\n\n{{description}}',
          sections: [],
        },
      },
    };

    const typeTemplates = templates[type] ?? templates.rule;
    const template = typeTemplates[templateLevel] ?? typeTemplates.standard;

    return {
      content: template.content
        .replaceAll('{{name}}', name)
        .replaceAll('{{description}}', description),
      sections: template.sections,
    };
  }

  async generateForPlatform(
    ir: GeneratedIR,
    options: Required<Pick<GenerateCommandOptions, 'platform'>> & GenerateCommandOptions
  ): Promise<GeneratedPlatformFile> {
    const adapter = getObjectProperty(this.generator.ruleAdapters, options.platform);

    if (!isRuleGeneratorAdapter(adapter)) {
      throw new Error(`Unsupported platform: ${options.platform}`);
    }

    const result = adapter.generateFromIR(ir, options);

    if (!options.dryRun) {
      const outputDir = options.output ?? process.cwd();
      const fullPath = path.join(outputDir, result.filePath);

      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, result.content, 'utf8');

      result.fullPath = fullPath;
    }

    return result;
  }

  checkPlatformSupport(platform: SupportedPlatform, type: ComponentType): PlatformSupportResult {
    const support: Record<SupportedPlatform, string[]> = {
      'claude-code': ['agent', 'rule', 'command', 'skill', 'main', 'settings'],
      cursor: ['rule'],
      'github-copilot': ['rule', 'main'],
      windsurf: ['rule', 'workflow'],
    };

    const platformSupport = support[platform] ?? [];

    if (platformSupport.includes(type)) {
      return { supported: true };
    }

    return {
      supported: false,
      message: `${platform} does not natively support ${type}s`,
      alternative: `Will be converted to ${platformSupport[0] ?? 'rule'} format`,
    };
  }

  showGenerateHelp(): void {
    this.logInfo('\nUsage examples:');
    this.logInfo('  vdk generate --type agent --name "code-review" --platform claude-code');
    this.logInfo('  vdk generate --type rule --name "typescript-best-practices" --globs "*.ts"');
    this.logInfo('  vdk generate --type command --name "deploy" --triggers "/deploy" "/ship"');
    this.logInfo('  vdk generate --type workflow --name "release" --platform windsurf');
    this.logInfo('\nComponent types:');
    this.logInfo('  agent     - Autonomous AI agent (Claude Code)');
    this.logInfo('  rule      - Context rules (all platforms)');
    this.logInfo('  command   - Slash commands (Claude Code)');
    this.logInfo('  skill     - Reusable skills (Claude Code)');
    this.logInfo('  workflow  - Procedural workflows (Windsurf)');
  }
}

function isRuleGeneratorAdapter(value: unknown): value is RuleGeneratorAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'generateFromIR' in value &&
    typeof value.generateFromIR === 'function'
  );
}
