/**
 * ValidateCommand
 * -----------------------
 * Handles 'vdk validate' command - Validate blueprint schema compatibility
 * and platform-specific component configuration.
 */

import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';

import { ClaudeCodeAdapter } from '../../scanner/core/ClaudeCodeAdapter.js';
import { CopilotAdapter } from '../../scanner/core/CopilotAdapter.js';
import { CursorAdapter } from '../../scanner/core/CursorAdapter.js';
import { WindsurfAdapter } from '../../scanner/core/WindsurfAdapter.js';
import { colors, tables } from '../../utils/cli-styles.js';
import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type SupportedPlatform = 'claude-code' | 'cursor' | 'github-copilot' | 'windsurf';
type ValidationFileType = 'frontmatter-config' | 'markdown-content' | 'unknown';
type ValidationPlatform = SupportedPlatform | 'generic' | 'unknown';

type ValidateCommandOptions = {
  file?: string;
  path?: string;
  platform?: SupportedPlatform;
  verbose?: boolean;
};

type ValidationResult = {
  errors: string[];
  file: string;
  platform: ValidationPlatform;
  type: ValidationFileType;
  valid: boolean;
  warnings: string[];
};

type ValidationOutcome = {
  errors: string[];
  platform: ValidationPlatform;
  type: ValidationFileType;
  valid: boolean;
  warnings: string[];
};

type ValidationAdapterResult = {
  errors: string[];
  valid: boolean;
  warnings?: string[];
};

type ValidationTable = {
  push: (row: [string, string, string, string]) => number;
  toString: () => string;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function detectPlatform(
  filePath: string,
  explicitPlatform?: SupportedPlatform
): ValidationPlatform {
  if (explicitPlatform) {
    return explicitPlatform;
  }

  if (filePath.includes('.cursor')) {
    return 'cursor';
  }

  if (filePath.includes('.claude') || filePath.includes('CLAUDE.md')) {
    return 'claude-code';
  }

  if (filePath.includes('copilot')) {
    return 'github-copilot';
  }

  if (filePath.includes('.windsurf')) {
    return 'windsurf';
  }

  return 'generic';
}

export class ValidateCommand extends BaseCommand {
  private readonly adapters: Record<
    SupportedPlatform,
    (content: string) => ValidationAdapterResult
  >;

  constructor() {
    super('validate', 'Validate blueprint schema compatibility and platform configurations');
    const claudeCodeAdapter = new ClaudeCodeAdapter();
    const cursorAdapter = new CursorAdapter();
    const copilotAdapter = new CopilotAdapter();
    const windsurfAdapter = new WindsurfAdapter();

    this.adapters = {
      'claude-code': (content: string) =>
        this.normalizeValidationResult(claudeCodeAdapter.validate(content, 'claude-code', 'main')),
      cursor: (content: string) =>
        this.normalizeValidationResult(cursorAdapter.validate(content, 'cursor', 'main')),
      'github-copilot': (content: string) =>
        this.normalizeValidationResult(copilotAdapter.validate(content)),
      windsurf: (content: string) =>
        this.normalizeValidationResult(windsurfAdapter.validate(content, 'windsurf', 'main')),
    };
  }

  normalizeValidationResult(result: unknown): ValidationAdapterResult {
    if (!isObject(result)) {
      return {
        valid: false,
        errors: ['Validation returned an unexpected result shape'],
        warnings: [],
      };
    }

    const errors = Array.isArray(result.errors)
      ? result.errors.filter((error): error is string => typeof error === 'string')
      : [];
    const warnings = Array.isArray(result.warnings)
      ? result.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [];

    return {
      valid: result.valid === true,
      errors,
      warnings,
    };
  }

  configureOptions(command: Command): Command {
    return command
      .option('-p, --path <path>', 'Path to blueprint artifact files', './.vdk/blueprints/rules')
      .option('-f, --file <file>', 'Validate specific blueprint file')
      .option('--platform <platform>', 'Validate against specific platform constraints')
      .option('-v, --verbose', 'Show detailed validation results', false);
  }

  async execute(options: ValidateCommandOptions): Promise<{
    errorFiles: number;
    results: ValidationResult[];
    success: boolean;
    totalFiles: number;
    validFiles: number;
  }> {
    await commandContext.initialize();
    this.showHeader('Schema Validation');

    const spinner = this.createSpinner('Validating files...');
    spinner.start();

    try {
      const filesToValidate = await this.getFilesToValidate(options);

      if (filesToValidate.length === 0) {
        spinner.fail('No files found to validate');
        return {
          success: false,
          totalFiles: 0,
          validFiles: 0,
          errorFiles: 0,
          results: [],
        };
      }

      spinner.text = `Validating ${filesToValidate.length} files...`;

      const results = await this.validateFiles(filesToValidate, options);
      spinner.stop();

      this.displayValidationResults(results, options);

      const successCount = results.filter(result => result.valid).length;
      const errorCount = results.length - successCount;

      this.trackSuccess({
        filesValidated: filesToValidate.length,
        successCount,
        errorCount,
      });

      return {
        success: errorCount === 0,
        totalFiles: filesToValidate.length,
        validFiles: successCount,
        errorFiles: errorCount,
        results,
      };
    } catch (error) {
      spinner.fail('Validation failed');
      throw error;
    }
  }

  async getFilesToValidate(options: ValidateCommandOptions): Promise<string[]> {
    if (options.file) {
      return [path.resolve(options.file)];
    }

    const searchPath = path.resolve(options.path ?? './.vdk/blueprints/rules');
    if (!(await pathExists(searchPath))) {
      return [];
    }

    const searchPathStats = await stat(searchPath);
    if (searchPathStats.isFile()) {
      return [searchPath];
    }

    const files: string[] = [];

    const walk = async (directoryPath: string): Promise<void> => {
      const entries = await readdir(directoryPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
          if (
            !entry.name.startsWith('.') ||
            ['claude', 'cursor', 'github', 'windsurf'].some(platform =>
              entry.name.includes(platform)
            )
          ) {
            await walk(fullPath);
          }
          continue;
        }

        if (/\.(json|md|mdc|yaml)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    };

    await walk(searchPath);
    return files;
  }

  async validateFiles(
    filesToValidate: string[],
    options: ValidateCommandOptions
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const filePath of filesToValidate) {
      try {
        const content = await readFile(filePath, 'utf8');
        const validation = await this.validateContent(content, filePath, options);

        results.push({
          file: commandContext.getRelativePath(filePath),
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings,
          type: validation.type,
          platform: validation.platform,
        });
      } catch (error) {
        results.push({
          file: commandContext.getRelativePath(filePath),
          valid: false,
          errors: [`Read error: ${getErrorMessage(error)}`],
          warnings: [],
          type: 'unknown',
          platform: 'unknown',
        });
      }
    }

    return results;
  }

  async validateContent(
    content: string,
    filePath: string,
    options: ValidateCommandOptions
  ): Promise<ValidationOutcome> {
    const platform = detectPlatform(filePath, options.platform);
    const result: ValidationOutcome = {
      valid: true,
      errors: [],
      warnings: [],
      type: content.startsWith('---') ? 'frontmatter-config' : 'markdown-content',
      platform,
    };

    const adapter =
      platform === 'generic' || platform === 'unknown' ? undefined : this.adapters[platform];

    if (adapter) {
      const platformValidation = adapter(content);
      if (!platformValidation.valid) {
        result.valid = false;
        result.errors.push(...platformValidation.errors);
      }
      if (platformValidation.warnings) {
        result.warnings.push(...platformValidation.warnings);
      }
    }

    if (platform === 'github-copilot' && content.length > 3000) {
      result.valid = false;
      result.errors.push(`Content exceeds 3000 chars (length: ${content.length})`);
    }

    return result;
  }

  displayValidationResults(results: ValidationResult[], options: ValidateCommandOptions): void {
    const resultTable: ValidationTable = tables.validation();

    for (const result of results) {
      const statusIcon = result.valid ? this.colorPrimary('✓') : colors.error('✗');
      let details = result.type;

      if (result.errors.length > 0) {
        const errorText = options.verbose
          ? result.errors.join(', ')
          : `${result.errors.length} error(s)`;
        details += ` | ${colors.error(errorText)}`;
      }

      if (result.warnings.length > 0) {
        const warningText = options.verbose
          ? result.warnings.join(', ')
          : `${result.warnings.length} warning(s)`;
        details += ` | ${colors.warning(warningText)}`;
      }

      resultTable.push([result.file, result.platform, statusIcon, details]);
    }

    writeStdout(resultTable.toString());

    const validCount = results.filter(result => result.valid).length;
    const errorCount = results.length - validCount;

    writeStdout(`\n${validCount} valid, ${errorCount} errors`);

    if (errorCount > 0 && !options.verbose) {
      this.logInfo('Use --verbose flag to see detailed error messages');
    }

    if (errorCount > 0) {
      process.exitCode = 1;
    }
  }
}
