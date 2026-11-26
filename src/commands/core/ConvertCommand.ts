/**
 * ConvertCommand
 * --------------
 * Handles 'vdk convert' command - Convert AI context between platforms.
 * Supports Claude Code -> Cursor, Copilot, Windsurf and vice versa.
 */

import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { Command } from 'commander';

import { UniversalFormatConverter } from '../../publishing/UniversalFormatConverter.js';
import { BaseCommand, type ValidationRules } from '../base/BaseCommand.js';

type SupportedPlatform = 'claude-code' | 'cursor' | 'github-copilot' | 'windsurf';

type ConvertCommandOptions = {
  all?: boolean;
  dryRun?: boolean;
  from?: SupportedPlatform | 'auto';
  input?: string;
  output?: string;
  preserveStructure?: boolean;
  quiet?: boolean;
  showLoss?: boolean;
  to?: SupportedPlatform[];
  verbose?: boolean;
};

type LossInfo = {
  field: string;
  reason: string;
  suggestion?: string;
};

type ConvertedPlatformResult = {
  content: string;
  filePath: string;
  lossInfo?: LossInfo[];
};

type ConvertedFileOutput = {
  lossInfo: LossInfo[];
  path: string;
  platform: string;
};

type FileConversionResult =
  | {
      inputPath: string;
      outputFiles: ConvertedFileOutput[];
      success: true;
      totalLoss: number;
    }
  | {
      error: string;
      success: false;
    };

type DirectoryConversionResult =
  | {
      errorCount: number;
      filesProcessed: number;
      results: Array<FileConversionResult & { file: string }>;
      success: boolean;
      successCount: number;
    }
  | {
      error: string;
      success: false;
    };

type PlatformOptions = Partial<Record<SupportedPlatform, Record<string, boolean | number>>>;

type SupportedConversionInfo = {
  characterLimit?: number | null;
  supportsAgents?: boolean;
  supportsCommands?: boolean;
  supportsRules?: boolean;
  supportsWorkflows?: boolean;
};

type UniversalFormatConverterLike = {
  convertToMultiplePlatformsViaIR: (options: {
    content: string;
    filePath: string;
    platformOptions: PlatformOptions;
    targetPlatforms: SupportedPlatform[];
  }) => Promise<Record<string, ConvertedPlatformResult>>;
  getSupportedConversions: () => Record<string, SupportedConversionInfo>;
};

const SUPPORTED_PLATFORMS: SupportedPlatform[] = [
  'claude-code',
  'cursor',
  'github-copilot',
  'windsurf',
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class ConvertCommand extends BaseCommand {
  private readonly converter: UniversalFormatConverterLike;

  constructor() {
    super('convert', 'Convert AI context between platforms (Claude, Cursor, Copilot, Windsurf)');
    const converter = new UniversalFormatConverter();
    this.converter = {
      convertToMultiplePlatformsViaIR: async options => {
        const results = await converter.convertToMultiplePlatformsViaIR(options);
        return this.normalizeConversionResults(results);
      },
      getSupportedConversions: () =>
        this.normalizeSupportedConversions(converter.getSupportedConversions()),
    };
  }

  normalizeConversionResults(results: unknown): Record<string, ConvertedPlatformResult> {
    if (typeof results !== 'object' || results === null) {
      return {};
    }

    const normalizedResults: Record<string, ConvertedPlatformResult> = {};
    for (const [platform, result] of Object.entries(results)) {
      if (
        typeof result === 'object' &&
        result !== null &&
        'content' in result &&
        'filePath' in result &&
        typeof result.content === 'string' &&
        typeof result.filePath === 'string'
      ) {
        normalizedResults[platform] = {
          content: result.content,
          filePath: result.filePath,
          lossInfo:
            Array.isArray(result.lossInfo) &&
            result.lossInfo.every(
              (loss: unknown) =>
                typeof loss === 'object' &&
                loss !== null &&
                'field' in loss &&
                'reason' in loss &&
                typeof loss.field === 'string' &&
                typeof loss.reason === 'string'
            )
              ? result.lossInfo.map((loss: LossInfo) => ({
                  field: loss.field,
                  reason: loss.reason,
                  suggestion:
                    'suggestion' in loss && typeof loss.suggestion === 'string'
                      ? loss.suggestion
                      : undefined,
                }))
              : undefined,
        };
      }
    }

    return normalizedResults;
  }

  normalizeSupportedConversions(rawConversions: unknown): Record<string, SupportedConversionInfo> {
    if (typeof rawConversions !== 'object' || rawConversions === null) {
      return {};
    }

    const normalizedConversions: Record<string, SupportedConversionInfo> = {};
    for (const [platform, info] of Object.entries(rawConversions)) {
      if (typeof info === 'object' && info !== null) {
        normalizedConversions[platform] = {
          characterLimit:
            'characterLimit' in info && typeof info.characterLimit === 'number'
              ? info.characterLimit
              : null,
          supportsAgents:
            'supportsAgents' in info && typeof info.supportsAgents === 'boolean'
              ? info.supportsAgents
              : undefined,
          supportsCommands:
            'supportsCommands' in info && typeof info.supportsCommands === 'boolean'
              ? info.supportsCommands
              : undefined,
          supportsRules:
            'supportsRules' in info && typeof info.supportsRules === 'boolean'
              ? info.supportsRules
              : undefined,
          supportsWorkflows:
            'supportsWorkflows' in info && typeof info.supportsWorkflows === 'boolean'
              ? info.supportsWorkflows
              : undefined,
        };
      }
    }

    return normalizedConversions;
  }

  configureOptions(command: Command): Command {
    return command
      .option('-i, --input <path>', 'Input file or directory to convert')
      .option('-o, --output <path>', 'Output directory for converted files')
      .option('-f, --from <platform>', 'Source platform (auto-detect if not specified)')
      .option(
        '-t, --to <platforms...>',
        'Target platform(s): claude-code, cursor, github-copilot, windsurf'
      )
      .option('--all', 'Convert to all supported platforms', false)
      .option('--dry-run', 'Preview conversion without writing files', false)
      .option('--preserve-structure', 'Preserve directory structure in output', true)
      .option('--show-loss', 'Show detailed information about conversion loss', false)
      .option('-v, --verbose', 'Enable verbose output', false);
  }

  getValidationRules(): ValidationRules {
    return {
      defaults: {
        output: './',
        preserveStructure: true,
        dryRun: false,
        showLoss: false,
        verbose: false,
        all: false,
      },
      fields: {
        from: {
          type: 'string',
          enum: ['claude-code', 'cursor', 'github-copilot', 'windsurf', 'auto'],
        },
        to: {
          type: 'array',
          validate: (targets: unknown) => {
            if (!Array.isArray(targets) || targets.length === 0) {
              return true;
            }

            const invalid = targets.filter(
              (target): target is string =>
                typeof target === 'string' &&
                !SUPPORTED_PLATFORMS.includes(target as SupportedPlatform)
            );

            if (invalid.length > 0) {
              return `Invalid target platforms: ${invalid.join(', ')}. Valid: ${SUPPORTED_PLATFORMS.join(', ')}`;
            }

            return true;
          },
        },
      },
    };
  }

  async execute(
    options: ConvertCommandOptions
  ): Promise<FileConversionResult | DirectoryConversionResult | { success: false }> {
    this.showHeader();
    await this.validateOptions(options, this.getValidationRules());

    if (!options.input) {
      this.logError('Input file or directory is required. Use --input <path>');
      this.showConversionHelp();
      return { success: false };
    }

    let targetPlatforms = options.to ?? [];
    if (options.all) {
      targetPlatforms = [...SUPPORTED_PLATFORMS];
    }

    if (targetPlatforms.length === 0) {
      this.logError('At least one target platform is required. Use --to <platform> or --all');
      this.showConversionHelp();
      return { success: false };
    }

    const inputPath = path.resolve(options.input);
    const outputPath = path.resolve(options.output ?? './');

    if (!(await pathExists(inputPath))) {
      this.logError(`Input path does not exist: ${inputPath}`);
      return { success: false };
    }

    const inputStats = await stat(inputPath);
    if (inputStats.isDirectory()) {
      return this.convertDirectory(inputPath, outputPath, targetPlatforms, options);
    }

    return this.convertFile(inputPath, outputPath, targetPlatforms, options);
  }

  async convertFile(
    inputPath: string,
    outputPath: string,
    targetPlatforms: SupportedPlatform[],
    options: ConvertCommandOptions
  ): Promise<FileConversionResult> {
    const spinner = this.createSpinner('Converting file...');
    spinner.start();

    try {
      const content = await readFile(inputPath, 'utf8');
      const results = await this.converter.convertToMultiplePlatformsViaIR({
        content,
        filePath: inputPath,
        targetPlatforms,
        platformOptions: this.getPlatformOptions(),
      });

      spinner.succeed('Conversion complete');

      const outputFiles: ConvertedFileOutput[] = [];
      let totalLoss = 0;

      for (const [platform, result] of Object.entries(results)) {
        const outputFilePath = this.getOutputPath(outputPath, result.filePath, platform, options);

        if (options.dryRun) {
          if (!options.quiet) {
            this.logInfo(`[DRY RUN] Would create: ${outputFilePath}`);
          }
        } else {
          await mkdir(path.dirname(outputFilePath), { recursive: true });
          await writeFile(outputFilePath, result.content, 'utf8');
          if (!options.quiet) {
            this.logSuccess(`Created: ${this.formatPath(outputFilePath)}`);
          }
        }

        const lossInfo = result.lossInfo ?? [];
        outputFiles.push({
          platform,
          path: outputFilePath,
          lossInfo,
        });

        if (options.showLoss && lossInfo.length > 0) {
          this.showLossInfo(platform, lossInfo);
          totalLoss += lossInfo.length;
        }
      }

      if (!options.quiet) {
        this.logInfo('\n📊 Conversion Summary:');
        this.logInfo(`   Source: ${this.formatPath(inputPath)}`);
        this.logInfo(`   Targets: ${targetPlatforms.join(', ')}`);
        this.logInfo(`   Files created: ${outputFiles.length}`);
        if (totalLoss > 0) {
          this.logWarning(`   ⚠️  ${totalLoss} item(s) lost during conversion`);
        }
      }

      return {
        success: true,
        inputPath,
        outputFiles,
        totalLoss,
      };
    } catch (error) {
      spinner.fail('Conversion failed');
      const conversionError = getErrorMessage(error);
      this.logError(conversionError);
      return { success: false, error: conversionError };
    }
  }

  async convertDirectory(
    inputPath: string,
    outputPath: string,
    targetPlatforms: SupportedPlatform[],
    options: ConvertCommandOptions
  ): Promise<DirectoryConversionResult> {
    const spinner = this.createSpinner('Scanning directory...');
    spinner.start();

    try {
      const files = await this.findConvertibleFiles(inputPath);
      spinner.text = `Found ${files.length} file(s) to convert`;

      if (files.length === 0) {
        spinner.warn('No convertible files found');
        return {
          success: true,
          filesProcessed: 0,
          successCount: 0,
          errorCount: 0,
          results: [],
        };
      }

      spinner.succeed(`Found ${files.length} file(s)`);

      const results: Array<FileConversionResult & { file: string }> = [];
      let successCount = 0;
      let errorCount = 0;

      for (const file of files) {
        const relativePath = path.relative(inputPath, file);
        const fileOutputPath = options.preserveStructure
          ? path.join(outputPath, path.dirname(relativePath))
          : outputPath;

        const result = await this.convertFile(file, fileOutputPath, targetPlatforms, {
          ...options,
          quiet: true,
        });

        if (result.success) {
          successCount += 1;
        } else {
          errorCount += 1;
        }

        results.push({ file, ...result });
      }

      this.logInfo('\n📊 Batch Conversion Summary:');
      this.logInfo(`   Directory: ${this.formatPath(inputPath)}`);
      this.logInfo(`   Files processed: ${files.length}`);
      this.logSuccess(`   Successful: ${successCount}`);
      if (errorCount > 0) {
        this.logError(`   Failed: ${errorCount}`);
      }

      return {
        success: errorCount === 0,
        filesProcessed: files.length,
        successCount,
        errorCount,
        results,
      };
    } catch (error) {
      spinner.fail('Directory conversion failed');
      const conversionError = getErrorMessage(error);
      this.logError(conversionError);
      return { success: false, error: conversionError };
    }
  }

  async findConvertibleFiles(directoryPath: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.json', '.md', '.mdc', '.yaml', '.yml'];

    const walk = async (currentDirectory: string): Promise<void> => {
      const entries = await readdir(currentDirectory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDirectory, entry.name);

        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            (entry.name.startsWith('.') &&
              !['claude', 'cursor', 'github', 'windsurf'].some(platform =>
                entry.name.includes(platform)
              ))
          ) {
            continue;
          }

          await walk(fullPath);
          continue;
        }

        if (
          extensions.some(extension => entry.name.endsWith(extension)) &&
          this.isContextFile(fullPath)
        ) {
          files.push(fullPath);
        }
      }
    };

    await walk(directoryPath);
    return files;
  }

  isContextFile(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    const fileName = path.basename(lowerPath);

    const knownFiles = ['claude.md', 'copilot-instructions.md'];
    if (knownFiles.some(knownFile => fileName.includes(knownFile))) {
      return true;
    }

    return (
      lowerPath.includes('.claude/') ||
      lowerPath.includes('.cursor/') ||
      lowerPath.includes('.windsurf/') ||
      lowerPath.includes('.github/copilot')
    );
  }

  getOutputPath(
    baseOutputPath: string,
    suggestedPath: string,
    platform: string,
    options: ConvertCommandOptions
  ): string {
    if (options.preserveStructure) {
      return path.join(baseOutputPath, platform, suggestedPath);
    }

    return path.join(baseOutputPath, suggestedPath);
  }

  getPlatformOptions(): PlatformOptions {
    return {
      'github-copilot': {
        maxLength: 3000,
        priorityTruncation: true,
      },
      cursor: {
        useMDC: true,
      },
    };
  }

  showLossInfo(platform: string, lossInfo: LossInfo[]): void {
    this.logWarning(`\n⚠️  Conversion loss for ${platform}:`);
    for (const loss of lossInfo) {
      this.logWarning(`   • ${loss.field}: ${loss.reason}`);
      if (loss.suggestion) {
        this.logInfo(`     💡 ${loss.suggestion}`);
      }
    }
  }

  showConversionHelp(): void {
    this.logInfo('\nUsage examples:');
    this.logInfo('  vdk convert --input CLAUDE.md --to cursor');
    this.logInfo('  vdk convert --input .claude/ --to cursor github-copilot --output ./converted');
    this.logInfo('  vdk convert --input .cursor/rules/index.mdc --to claude-code --dry-run');
    this.logInfo('  vdk convert --input ./project --all --show-loss');
    this.logInfo('\nSupported platforms:');

    const conversions = this.converter.getSupportedConversions();
    for (const [platform, info] of Object.entries(conversions)) {
      const features = [
        info.supportsAgents ? 'agents' : null,
        info.supportsRules ? 'rules' : null,
        info.supportsCommands ? 'commands' : null,
        info.supportsWorkflows ? 'workflows' : null,
      ].filter((feature): feature is string => feature !== null);
      const limit = info.characterLimit ? ` (${info.characterLimit} char limit)` : '';
      this.logInfo(`  ${platform}: ${features.join(', ')}${limit}`);
    }
  }
}

export default ConvertCommand;
