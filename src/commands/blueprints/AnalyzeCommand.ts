/**
 * AnalyzeCommand
 * -----------------------
 * Analyze blueprint dependencies and relationships.
 */

import type { Command } from 'commander';

import { BaseCommand, type CommandOptions } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type BlueprintMetadata = {
  description?: string;
  id?: string;
  kind?: string;
  title?: string;
  version?: string;
};

type BlueprintDependencyAnalysis = {
  blueprint: BlueprintMetadata;
  conflicts: BlueprintMetadata[];
  dependencies: {
    available: BlueprintMetadata[];
    missing: string[];
    required: BlueprintMetadata[];
    suggested: BlueprintMetadata[];
  };
  superseded: BlueprintMetadata[];
};

type AnalyzeBlueprintDependenciesModule = {
  analyzeBlueprintDependencies: (blueprintId: string) => Promise<object>;
};

type AnalyzeCommandOptions = CommandOptions & {
  args?: unknown[];
  verbose?: boolean;
};

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

async function loadAnalysisModule(): Promise<AnalyzeBlueprintDependenciesModule> {
  return import('../../blueprints-client.js');
}

function normalizeMetadata(value: unknown): BlueprintMetadata {
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

function normalizeMetadataArray(value: unknown): BlueprintMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeMetadata);
}

function normalizeAnalysisResult(value: unknown): BlueprintDependencyAnalysis {
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
    blueprint: normalizeMetadata(value.blueprint),
    conflicts: normalizeMetadataArray(value.conflicts),
    dependencies: {
      available: normalizeMetadataArray(dependencies.available),
      missing: Array.isArray(dependencies.missing)
        ? dependencies.missing.filter((entry): entry is string => typeof entry === 'string')
        : [],
      required: normalizeMetadataArray(dependencies.required),
      suggested: normalizeMetadataArray(dependencies.suggested),
    },
    superseded: normalizeMetadataArray(value.superseded),
  };
}

export class AnalyzeCommand extends BaseCommand {
  constructor() {
    super('analyze', 'Analyze blueprint dependencies and relationships');
  }

  configureOptions(command: Command): Command {
    return command
      .argument('<blueprint-id>', 'Blueprint ID to analyze')
      .option('-v, --verbose', 'Show detailed analysis information', false);
  }

  async execute(options: AnalyzeCommandOptions): Promise<BlueprintDependencyAnalysis> {
    await commandContext.initialize();

    const blueprintArgument = options.args?.[0];
    const blueprintId = typeof blueprintArgument === 'string' ? blueprintArgument : '';

    if (!blueprintId) {
      this.exitWithError('Blueprint ID argument is required. Use --help for usage information');
    }

    this.showHeader(`Blueprint Analysis: ${blueprintId}`);

    try {
      const analysis = await this.performAnalysis(blueprintId, options.verbose === true);
      this.displayAnalysisResults(analysis, options.verbose === true);

      this.trackSuccess({
        blueprintId,
        hasConflicts: analysis.conflicts.length > 0,
        hasDependencies: analysis.dependencies.required.length > 0,
        missingDependencies: analysis.dependencies.missing.length,
      });

      return analysis;
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError(`Analysis failed: ${commandError.message}`, commandError);
    }
  }

  async performAnalysis(
    blueprintId: string,
    verbose: boolean
  ): Promise<BlueprintDependencyAnalysis> {
    const spinner = this.createSpinner('Analyzing blueprint dependencies...');
    spinner.start();

    try {
      const analysisModule = await loadAnalysisModule();
      const rawAnalysis = await analysisModule.analyzeBlueprintDependencies(blueprintId);
      const analysis = normalizeAnalysisResult(rawAnalysis);
      spinner.succeed('Analysis complete');

      if (verbose) {
        const graph = {
          [analysis.blueprint.id ?? blueprintId]: {
            conflicts: analysis.conflicts.map(conflict => conflict.id ?? 'unknown'),
            requires: analysis.dependencies.required.map(dependency => dependency.id ?? 'unknown'),
            suggests: analysis.dependencies.suggested.map(dependency => dependency.id ?? 'unknown'),
            supersedes: analysis.superseded.map(blueprint => blueprint.id ?? 'unknown'),
          },
        };
        writeStdout('');
        writeStdout('Dependency Graph:');
        writeStdout(JSON.stringify(graph, null, 2));
      }

      return analysis;
    } catch (error) {
      spinner.fail('Analysis failed');
      throw error;
    }
  }

  displayAnalysisResults(analysis: BlueprintDependencyAnalysis, _verbose: boolean): void {
    writeStdout('');
    writeStdout('Blueprint Analysis:');
    writeStdout(`  ID: ${analysis.blueprint.id ?? 'Unknown'}`);
    writeStdout(`  Kind: ${analysis.blueprint.kind ?? 'Unknown'}`);
    writeStdout(`  Version: ${analysis.blueprint.version ?? 'Unknown'}`);
    writeStdout(`  Title: ${analysis.blueprint.title ?? 'Untitled'}`);

    if (analysis.blueprint.description) {
      writeStdout(`  Description: ${analysis.blueprint.description}`);
    }

    if (analysis.dependencies.required.length > 0) {
      writeStdout('');
      writeStdout('  Required Dependencies:');
      for (const dependency of analysis.dependencies.required) {
        writeStdout(`    - ${dependency.id ?? 'unknown'} (${dependency.version ?? '*'})`);
      }
    }

    if (analysis.dependencies.suggested.length > 0) {
      writeStdout('');
      writeStdout('  Suggested Dependencies:');
      for (const dependency of analysis.dependencies.suggested) {
        writeStdout(`    - ${dependency.id ?? 'unknown'}`);
      }
    }

    if (analysis.dependencies.missing.length > 0) {
      writeStdout('');
      this.logWarning('  Missing Dependencies:');
      for (const dependencyId of analysis.dependencies.missing) {
        writeStdout(`    - ${dependencyId}`);
      }
    }

    if (analysis.conflicts.length > 0) {
      writeStdout('');
      this.logWarning('  Conflicts With:');
      for (const conflict of analysis.conflicts) {
        writeStdout(`    - ${conflict.id ?? 'unknown'}`);
      }
    }

    if (analysis.superseded.length > 0) {
      writeStdout('');
      writeStdout('  Supersedes:');
      for (const supersededBlueprint of analysis.superseded) {
        writeStdout(`    - ${supersededBlueprint.id ?? 'unknown'}`);
      }
    }
  }

  displayVerboseAnalysis(_analysis: BlueprintDependencyAnalysis): void {}

  displayRecommendations(_analysis: BlueprintDependencyAnalysis): void {}
}
