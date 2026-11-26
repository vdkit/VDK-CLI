/**
 * ImportCommand
 * -------------
 * Handles 'vdk import' command - Import existing AI context from various platforms.
 * Auto-detects platform and converts to VDK format / IR.
 */

import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';

import { detectPlatformFromPath } from '../../ir/index.js';
import { createIR, validateIR } from '../../ir/types.js';
import { UniversalFormatConverter } from '../../publishing/UniversalFormatConverter.js';
import { BaseCommand } from '../base/BaseCommand.js';

type SupportedPlatform =
  | 'claude-code'
  | 'continue'
  | 'cursor'
  | 'generic'
  | 'github-copilot'
  | 'windsurf';

type ImportCommandOptions = {
  analyze?: boolean;
  input?: string;
  merge?: boolean;
  output?: string;
  platform?: SupportedPlatform | string;
  verbose?: boolean;
};

type IntermediateRepresentation = ReturnType<typeof createIR>;

type ValidationResponse = {
  errors: string[];
  valid: boolean;
};

type ContextFile = {
  path: string;
  platform: string;
};

type AnalysisSummary = {
  componentType: string;
  contentSections: number;
  description: string;
  fileReferenceCount: number;
  hasTools: boolean;
  hasTriggers: boolean;
  name: string;
};

type ImportAnalysis = {
  analysis: AnalysisSummary;
  errors: string[];
  ir: IntermediateRepresentation;
  relativePath: string;
  sourcePlatform: string;
  sourcePath: string;
  valid: boolean;
};

type UniversalFormatConverterLike = {
  importToIR: (options: {
    content: string;
    filePath: string;
    platform?: string;
  }) =>
    | IntermediateRepresentation
    | IntermediateRepresentation[]
    | Promise<IntermediateRepresentation | IntermediateRepresentation[]>;
};

type ImportCommandResult =
  | {
      analyses: ImportAnalysis[];
      filesImported: number;
      outputPath: string;
      success: true;
    }
  | {
      analyses: ImportAnalysis[];
      mode: 'analyze';
      success: true;
    }
  | {
      filesImported: 0;
      success: true;
    }
  | {
      error: string;
      success: false;
    };

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getObjectProperty(value: unknown, key: string): unknown {
  if (!isObject(value)) {
    return undefined;
  }

  return Reflect.get(value, key);
}

function slugifyFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export class ImportCommand extends BaseCommand {
  private readonly converter: UniversalFormatConverterLike;

  constructor() {
    super('import', 'Import existing AI context from Claude, Cursor, Copilot, or Windsurf');
    this.converter = new UniversalFormatConverter();
  }

  configureOptions(command: Command): Command {
    return command
      .option('-i, --input <path>', 'Input file or directory to import', '.')
      .option('-o, --output <path>', 'Output directory for imported files', './.vdk/imported')
      .option('-p, --platform <platform>', 'Override platform detection')
      .option('--analyze', 'Only analyze without importing', false)
      .option('--merge', 'Merge with existing VDK rules', false)
      .option('-v, --verbose', 'Enable verbose output', false);
  }

  async execute(options: ImportCommandOptions): Promise<ImportCommandResult> {
    this.showHeader();

    const inputPath = path.resolve(options.input ?? '.');
    const outputPath = path.resolve(options.output ?? './.vdk/imported');

    if (!(await pathExists(inputPath))) {
      this.logError(`Input path does not exist: ${inputPath}`);
      return { success: false, error: 'Input path does not exist' };
    }

    const spinner = this.createSpinner('Detecting AI context files...');
    spinner.start();

    try {
      const contextFiles = await this.findContextFiles(inputPath, options.platform);
      spinner.succeed(`Found ${contextFiles.length} AI context file(s)`);

      if (contextFiles.length === 0) {
        this.logWarning('No AI context files found. Looking for:');
        this.logInfo('  • .claude/ directory or CLAUDE.md');
        this.logInfo('  • .cursor/rules/');
        this.logInfo('  • .github/copilot-instructions.md');
        this.logInfo('  • .windsurf/rules/');
        return { success: true, filesImported: 0 };
      }

      const analyses = await this.buildAnalyses(contextFiles, inputPath, options.platform);
      this.showAnalysis(analyses, options.verbose === true);

      if (options.analyze) {
        return {
          success: true,
          mode: 'analyze',
          analyses,
        };
      }

      const importSpinner = this.createSpinner('Importing context files...');
      importSpinner.start();

      await mkdir(outputPath, { recursive: true });

      const importedFiles: string[] = [];
      const fileNameCounts = new Map<string, number>();

      for (const analysis of analyses) {
        const baseName =
          slugifyFileName(analysis.ir.name || 'imported-context') || 'imported-context';
        const currentCount = fileNameCounts.get(baseName) ?? 0;
        fileNameCounts.set(baseName, currentCount + 1);
        const suffix = currentCount === 0 ? '' : `-${currentCount + 1}`;
        const outputFile = path.join(outputPath, `${baseName}${suffix}.json`);

        const payload = {
          schemaVersion: '3.0',
          importedAt: new Date().toISOString(),
          sourcePlatform: analysis.sourcePlatform,
          sourceFile: analysis.relativePath,
          ir: analysis.ir,
        };

        await writeFile(outputFile, JSON.stringify(payload, null, 2), 'utf8');
        importedFiles.push(outputFile);
      }

      importSpinner.succeed(`Imported ${importedFiles.length} file(s)`);

      this.logInfo('\n📊 Import Summary:');
      this.logInfo(`   Source: ${this.formatPath(inputPath)}`);
      this.logInfo(`   Output: ${this.formatPath(outputPath)}`);
      this.logInfo(`   Files imported: ${importedFiles.length}`);

      const platformCounts = new Map<string, number>();
      for (const analysis of analyses) {
        platformCounts.set(
          analysis.sourcePlatform,
          (platformCounts.get(analysis.sourcePlatform) ?? 0) + 1
        );
      }
      for (const [platform, count] of platformCounts.entries()) {
        this.logInfo(`   ${platform}: ${count} file(s)`);
      }

      return {
        success: true,
        filesImported: importedFiles.length,
        analyses,
        outputPath,
      };
    } catch (error) {
      spinner.fail('Import failed');
      const importError = getErrorMessage(error);
      this.logError(importError);
      return { success: false, error: importError };
    }
  }

  async buildAnalyses(
    contextFiles: ContextFile[],
    inputPath: string,
    platformOverride?: string
  ): Promise<ImportAnalysis[]> {
    const analyses: ImportAnalysis[] = [];

    for (const file of contextFiles) {
      const content = await readFile(file.path, 'utf8');
      const imported = await Promise.resolve(
        this.converter.importToIR({
          content,
          filePath: file.path,
          platform: platformOverride ?? file.platform,
        })
      );

      const irComponents = this.normalizeImportedIR(imported);
      for (const ir of irComponents) {
        const validation: ValidationResponse = validateIR(ir);
        const conversionMetadata = getObjectProperty(ir, 'conversionMetadata');
        const sourcePlatform =
          isObject(conversionMetadata) && typeof conversionMetadata.sourcePlatform === 'string'
            ? conversionMetadata.sourcePlatform
            : file.platform;

        analyses.push({
          sourcePath: file.path,
          relativePath: path.relative(inputPath, file.path),
          sourcePlatform,
          ir,
          valid: validation.valid,
          errors: validation.errors,
          analysis: {
            componentType: ir.type ?? 'unknown',
            name: ir.name,
            description: ir.description ?? '',
            hasTriggers: Array.isArray(ir.triggers) && ir.triggers.length > 0,
            hasTools: Array.isArray(ir.tools) && ir.tools.length > 0,
            fileReferenceCount: Array.isArray(ir.fileReferences) ? ir.fileReferences.length : 0,
            contentSections: Array.isArray(ir.content?.sections) ? ir.content.sections.length : 0,
          },
        });
      }
    }

    return analyses;
  }

  normalizeImportedIR(value: unknown): IntermediateRepresentation[] {
    const values = Array.isArray(value) ? value : [value];

    return values.filter(
      (item): item is IntermediateRepresentation => isObject(item) && typeof item.name === 'string'
    );
  }

  async findContextFiles(inputPath: string, platformOverride?: string): Promise<ContextFile[]> {
    const inputStats = await stat(inputPath);

    if (inputStats.isFile()) {
      return [
        {
          path: inputPath,
          platform: platformOverride ?? detectPlatformFromPath(inputPath),
        },
      ];
    }

    const searchPatterns: Array<{ glob: string; platform: SupportedPlatform }> = [
      { glob: 'CLAUDE.md', platform: 'claude-code' },
      { glob: '.claude/**/*.md', platform: 'claude-code' },
      { glob: '.cursor/rules/**/*.mdc', platform: 'cursor' },
      { glob: '.cursor/rules/**/*.md', platform: 'cursor' },
      { glob: '.github/copilot-instructions.md', platform: 'github-copilot' },
      { glob: '.windsurf/rules/**/*.md', platform: 'windsurf' },
    ];

    const files: ContextFile[] = [];
    for (const pattern of searchPatterns) {
      const matches = await this.findFiles(inputPath, pattern.glob);
      for (const match of matches) {
        if (!files.some(file => file.path === match)) {
          files.push({
            path: match,
            platform: platformOverride ?? pattern.platform,
          });
        }
      }
    }

    return files;
  }

  async findFiles(basePath: string, pattern: string): Promise<string[]> {
    const matches: string[] = [];
    const parts = pattern.split('/');

    const walk = async (directoryPath: string, partIndex: number): Promise<void> => {
      if (partIndex >= parts.length) {
        return;
      }

      const part = parts[partIndex];
      const isLast = partIndex === parts.length - 1;

      try {
        const entries = await readdir(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(directoryPath, entry.name);

          if (part === '**') {
            if (entry.isDirectory()) {
              await walk(fullPath, partIndex);
              await walk(fullPath, partIndex + 1);
            } else if (isLast || this.matchGlob(entry.name, parts[partIndex + 1] ?? '')) {
              matches.push(fullPath);
            }
            continue;
          }

          if (!this.matchGlob(entry.name, part)) {
            continue;
          }

          if (isLast) {
            matches.push(fullPath);
          } else if (entry.isDirectory()) {
            await walk(fullPath, partIndex + 1);
          }
        }
      } catch {
        // Ignore unreadable directories.
      }
    };

    await walk(basePath, 0);
    return matches;
  }

  matchGlob(name: string, pattern: string): boolean {
    if (pattern === '*') {
      return true;
    }

    if (pattern.startsWith('*.')) {
      return name.endsWith(pattern.slice(1));
    }

    return name === pattern;
  }

  showAnalysis(analyses: ImportAnalysis[], verbose: boolean): void {
    this.logInfo('\n📋 Analysis Results:\n');

    for (const analysis of analyses) {
      const icon = analysis.valid ? '✅' : '⚠️';
      this.logInfo(`${icon} ${this.formatPath(analysis.relativePath)}`);
      this.logInfo(`   Platform: ${analysis.sourcePlatform}`);
      this.logInfo(`   Type: ${analysis.analysis.componentType}`);
      this.logInfo(`   Name: ${analysis.analysis.name}`);

      if (verbose) {
        if (analysis.analysis.description) {
          this.logInfo(`   Description: ${analysis.analysis.description.substring(0, 80)}...`);
        }
        if (analysis.analysis.hasTriggers) {
          this.logInfo('   Has triggers: Yes');
        }
        if (analysis.analysis.hasTools) {
          this.logInfo('   Has tools: Yes');
        }
        if (analysis.analysis.fileReferenceCount > 0) {
          this.logInfo(`   File references: ${analysis.analysis.fileReferenceCount}`);
        }
        if (analysis.analysis.contentSections > 0) {
          this.logInfo(`   Content sections: ${analysis.analysis.contentSections}`);
        }
      }

      if (!analysis.valid) {
        for (const error of analysis.errors) {
          this.logWarning(`   ⚠️ ${error}`);
        }
      }

      this.logInfo('');
    }
  }
}

export default ImportCommand;
