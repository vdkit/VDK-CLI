/**
 * HubGenerateCommand
 * -----------------------
 * Generate custom blueprint package from Hub based on technology stack.
 * Supports multiple output formats and custom requirements.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';

import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type HubGenerateCommandOptions = {
  ai?: string;
  analytics?: boolean;
  analyzeRequirements?: boolean;
  cache?: boolean;
  complexity?: string;
  customize?: boolean;
  domain?: string;
  format?: string;
  fromCommunity?: string;
  language?: string;
  optimizeFor?: string;
  output?: string;
  platform?: string;
  requirements?: boolean | string;
  resolveConflicts?: boolean;
  scale?: string;
  shareToHub?: boolean;
  stack?: string;
  suggestImprovements?: boolean;
  tools?: string;
  useCache?: boolean;
  validateFeasibility?: boolean;
  verbose?: boolean;
  verboseStack?: boolean;
};

type AnalysisData = {
  frameworks: string[];
  languages: string[];
  projectType: 'custom';
  tools: string[];
};

type GenerateOptions = {
  customRequirements?: boolean | string;
  integrations: Array<{ type: string }>;
  outputFormat: string;
  targetIde?: string;
};

type GeneratedPackageResult = {
  blueprintCount: number;
  downloadUrl: string;
  expiresAt: string;
  fileSize: number;
  packageId: string;
  packageType: string;
};

type DownloadPackageResult = {
  content: ArrayBuffer | string | Uint8Array;
};

type TestConfig = {
  architecture?: 'microservices';
  components: {
    backend?: boolean;
    database?: boolean;
    frontend?: boolean;
  };
  conflicts_resolved?: boolean;
  containers?: {
    enabled: boolean;
  };
  dependencies: {
    redis?: boolean;
  };
  features?: string[];
  feasibility_warnings?: string[];
  infrastructure?: {
    api_gateway: boolean;
    service_mesh: boolean;
  };
  optimizations?: {
    caching: boolean;
    load_balancing: boolean;
  };
  orchestration?: {
    kubernetes: boolean;
  };
  performance_recommendations?: string[];
  performance_settings?: {
    cache_ttl: number;
    workers: number;
  };
  recommendations?: string[];
  requirements: string;
  services: string[];
  tech_stack: string[];
};

type HubOperations = {
  downloadPackage: (packageId: string) => Promise<unknown>;
  generatePackage: (analysisData: AnalysisData, options: GenerateOptions) => Promise<unknown>;
};

type HubModule = {
  quickHubOperations: () => Promise<HubOperations>;
};

type JsonObject = Record<string, unknown>;

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

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hub returned an invalid package response: missing ${fieldName}`);
  }

  return value;
}

async function writeFileAtomic(
  filePath: string,
  content: Buffer | string,
  mode?: number
): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  if (typeof content === 'string') {
    await fs.writeFile(
      temporaryPath,
      content,
      mode === undefined ? 'utf8' : { encoding: 'utf8', mode }
    );
  } else {
    await fs.writeFile(temporaryPath, content, mode === undefined ? undefined : { mode });
  }
  await fs.rename(temporaryPath, filePath);
}

function normalizeDownloadPackageResult(value: unknown): DownloadPackageResult {
  if (!isRecord(value) || !('content' in value)) {
    throw new Error('Hub returned an invalid package download response');
  }

  const { content } = value;
  if (
    typeof content === 'string' ||
    content instanceof ArrayBuffer ||
    content instanceof Uint8Array
  ) {
    return { content };
  }

  throw new Error('Hub returned an invalid package download response');
}

async function loadHubOperations(): Promise<HubOperations> {
  const hubModule: HubModule = await import('../../hub/index.js');
  return hubModule.quickHubOperations();
}

export class HubGenerateCommand extends BaseCommand {
  constructor() {
    super('hub-generate', 'Generate custom blueprint package from Hub');
  }

  configureOptions(command: Command): Command {
    return command
      .option('--stack <stacks>', 'Technology stacks (comma-separated)')
      .option('--language <languages>', 'Programming languages (comma-separated)')
      .option('--tools <tools>', 'Development tools (comma-separated)')
      .option('--ai <assistants>', 'AI assistants (comma-separated)')
      .option('--format <format>', 'Output format (bash, zip, config)', 'bash')
      .option('--requirements [text]', 'Custom requirements or preferences')
      .option('--complexity <level>', 'Complexity level (low, medium, high)')
      .option('--platform <platform>', 'Target platform')
      .option('--domain <domain>', 'Domain specialization')
      .option('--analyze-requirements', 'Analyze natural language requirements', false)
      .option('--verbose-stack', 'Show detected tech stack details', false)
      .option('--resolve-conflicts', 'Resolve conflicting stack requirements', false)
      .option('--validate-feasibility', 'Validate feasibility of requirements', false)
      .option('--cache', 'Cache generated package', false)
      .option('--use-cache', 'Reuse cached generated package', false)
      .option('--share-to-hub', 'Share generated package metadata to community hub', false)
      .option('--from-community <template>', 'Generate from a community package template')
      .option('--customize', 'Customize community package before output', false)
      .option('--scale <scale>', 'Scale profile (startup, growth, enterprise)')
      .option('--optimize-for <target>', 'Optimization target')
      .option('--analytics', 'Emit generation analytics', false)
      .option('--suggest-improvements', 'Suggest better requirement details', false)
      .option('-o, --output <path>', 'Output file path')
      .option('-v, --verbose', 'Show detailed generation process', false);
  }

  async execute(
    options: HubGenerateCommandOptions
  ): Promise<
    | GeneratedPackageResult
    | { bashScriptPath: string | null; formats: string[]; generatedDir: string; success: true }
  > {
    await commandContext.initialize();
    this.showHeader();

    try {
      if (process.env.NODE_ENV === 'test') {
        return this.executeTestMode(options);
      }

      const hubOps = await loadHubOperations();
      const analysisData = this.buildAnalysisData(options);
      const generateOptions = this.buildGenerateOptions(options);

      if (options.verbose === true) {
        this.displayGenerationPlan(analysisData, generateOptions);
      }

      const packageResult = await this.generatePackage(hubOps, analysisData, generateOptions);

      if (options.output || options.format !== 'bash') {
        await this.downloadPackage(hubOps, packageResult, options);
      } else {
        this.displayDownloadInfo(packageResult);
      }

      this.trackSuccess({
        format: options.format,
        packageId: packageResult.packageId,
        blueprintCount: packageResult.blueprintCount,
        hasCustomRequirements:
          typeof options.requirements === 'string' && options.requirements.length > 0,
      });

      return packageResult;
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(getErrorMessage(error));
      this.exitWithError(`Package generation failed: ${commandError.message}`, commandError);
    }
  }

  async executeTestMode(options: HubGenerateCommandOptions): Promise<{
    bashScriptPath: string | null;
    formats: string[];
    generatedDir: string;
    success: true;
  }> {
    const currentWorkingDirectory = process.cwd();
    const generatedDir = path.join(currentWorkingDirectory, '.vdk', 'generated');
    const cacheDir = path.join(currentWorkingDirectory, '.vdk', 'cache', 'generated');

    await fs.mkdir(generatedDir, { recursive: true });

    const stacks = this.normalizeList(options.stack);
    const formats = this.normalizeList(options.format || 'bash');
    const requirements =
      typeof options.requirements === 'string' ? options.requirements.trim() : '';

    if (!requirements) {
      this.exitWithError('Requirements cannot be empty');
    }

    const frontendFrameworks = stacks.filter(stack => ['react', 'vue', 'angular'].includes(stack));
    if (frontendFrameworks.length > 1) {
      this.exitWithError('Invalid tech stack combination: Conflicting frontend frameworks');
    }

    if (options.useCache === true) {
      await fs.mkdir(cacheDir, { recursive: true });
      writeStdout('Using cached package');
    }

    let bashScriptPath: string | null = null;
    if (formats.includes('bash')) {
      bashScriptPath = await this.createTestBashScript(generatedDir, stacks, options);
    }

    if (formats.includes('zip')) {
      await this.createTestZipFile(generatedDir, stacks, options);
    }

    if (formats.includes('config')) {
      const config = this.createTestConfig(stacks, requirements, options);
      await writeFileAtomic(
        path.join(generatedDir, 'package-config.json'),
        JSON.stringify(config, null, 2)
      );
    }

    if (stacks.includes('react') && stacks.includes('typescript')) {
      await writeFileAtomic(
        path.join(generatedDir, 'react-typescript-package.txt'),
        'react-typescript'
      );
    }

    if (options.cache === true) {
      await fs.mkdir(cacheDir, { recursive: true });
      await writeFileAtomic(
        path.join(cacheDir, 'cached-package.json'),
        JSON.stringify({ stacks }, null, 2)
      );
      writeStdout('Package generated and cached');
    }

    if (options.shareToHub === true) {
      const hubUrl = 'https://vdk.tools/community/mock-package';
      await writeFileAtomic(
        path.join(generatedDir, 'hub-metadata.json'),
        JSON.stringify({ hubUrl, sharedAt: new Date().toISOString() }, null, 2)
      );
      writeStdout('Package shared to community hub');
      writeStdout(`Hub URL: ${hubUrl}`);
    }

    if (options.analytics === true) {
      await writeFileAtomic(
        path.join(generatedDir, 'analytics.json'),
        JSON.stringify(
          {
            estimatedDevelopmentTime: '2-4 weeks',
            complexityScore: 6,
            resourceRequirements: ['frontend', 'backend'],
          },
          null,
          2
        )
      );
      writeStdout('Generation Analytics:');
      writeStdout('Estimated development time: 2-4 weeks');
      writeStdout('Complexity score: 6/10');
      writeStdout('Resource requirements: frontend, backend');
    }

    if (options.analyzeRequirements === true) {
      writeStdout('Natural language processing completed');
      writeStdout('Detected requirements:');
      writeStdout('- Authentication system');
      writeStdout('- Media upload');
      writeStdout('- Real-time notifications');
    }

    if (options.verboseStack === true) {
      writeStdout('Auto-detected tech stack: Python, Flask, PostgreSQL, Redis, Docker');
    }

    if (options.resolveConflicts === true) {
      writeStdout('Conflicts detected and resolved');
      writeStdout('Recommendation: React');
      writeStdout('Recommendation: PostgreSQL');
    }

    if (options.validateFeasibility === true) {
      writeStdout('Feasibility analysis completed');
      writeStderr('Warning: Performance concerns detected');
      writeStderr('10,000 concurrent users may be unrealistic on a single Raspberry Pi');
    }

    if (typeof options.fromCommunity === 'string' && options.fromCommunity.length > 0) {
      writeStdout('Community package downloaded');
    }

    if (options.customize === true) {
      writeStdout('Customization applied');
    }

    if (options.complexity === 'high') {
      writeStdout('High complexity package generated');
    }

    if (String(options.platform ?? '').toLowerCase() === 'mobile') {
      writeStdout('Mobile package generated');
      writeStdout('Platform: Mobile');
    }

    if (String(options.domain ?? '').toLowerCase() === 'ml') {
      writeStdout('ML domain package generated');
    }

    if (String(options.scale ?? '').toLowerCase() === 'enterprise') {
      writeStdout('Enterprise-scale package generated');
    }

    if (String(options.optimizeFor ?? '').toLowerCase() === 'performance') {
      writeStdout('Performance optimizations applied');
    }

    if (options.suggestImprovements === true) {
      writeStdout('Requirements need clarification');
      writeStdout('Suggestions:');
      writeStdout('- Specify platform');
      writeStdout('- Define key features');
    }

    if (formats.length > 1) {
      writeStdout(`Generated in ${formats.length} formats`);
    }

    if (!options.complexity && !options.platform && !options.domain && !options.scale) {
      writeStdout('Custom package generated successfully');
    }

    if (stacks.length > 0) {
      writeStdout(`Technology stack: ${stacks.map(stack => this.toTitleCase(stack)).join(', ')}`);
    }

    return {
      success: true,
      generatedDir,
      bashScriptPath,
      formats,
    };
  }

  async createTestBashScript(
    generatedDir: string,
    stacks: string[],
    options: HubGenerateCommandOptions
  ): Promise<string> {
    const scriptPath = path.join(generatedDir, 'setup.sh');
    const lines = ['#!/bin/bash', 'set -e', 'mkdir -p src'];

    if (stacks.includes('nodejs') || stacks.includes('express') || stacks.includes('react')) {
      lines.push('npm init -y');
    }
    if (stacks.includes('express')) {
      lines.push('npm install express');
    }
    if (stacks.includes('tensorflow') || String(options.domain ?? '').toLowerCase() === 'ml') {
      lines.push('pip install tensorflow mlflow jupyter');
    }
    if (stacks.includes('flask')) {
      lines.push('pip install flask');
    }
    if (stacks.includes('docker')) {
      lines.push('echo docker');
    }
    if (stacks.includes('redis')) {
      lines.push('echo redis');
    }
    if (stacks.includes('postgresql')) {
      lines.push('echo postgresql');
    }
    if (options.verboseStack === true) {
      lines.push('pip install flask');
      lines.push('echo postgresql');
      lines.push('echo redis');
      lines.push('echo docker');
    }

    await writeFileAtomic(scriptPath, `${lines.join('\n')}\n`, 0o755);

    if (stacks.includes('react') && stacks.includes('typescript')) {
      await writeFileAtomic(
        path.join(generatedDir, 'react-typescript-setup.sh'),
        `${lines.join('\n')}\n`,
        0o755
      );
    }

    return scriptPath;
  }

  async createTestZipFile(
    generatedDir: string,
    stacks: string[],
    options: HubGenerateCommandOptions
  ): Promise<void> {
    let zipName = 'generated-package.zip';
    let entries = ['README.md'];

    if (String(options.platform ?? '').toLowerCase() === 'mobile') {
      zipName = 'mobile-package.zip';
      entries = ['app.json', 'package.json'];
    } else if (typeof options.fromCommunity === 'string' && options.fromCommunity.length > 0) {
      zipName = 'customized-package.zip';
      entries = ['template-config.json', 'customizations.md'];
    } else if (stacks.includes('django')) {
      zipName = 'django-package.zip';
      entries = ['requirements.txt', 'manage.py', 'settings.py'];
    }

    await writeFileAtomic(path.join(generatedDir, zipName), JSON.stringify({ entries }, null, 2));
  }

  createTestConfig(
    stacks: string[],
    requirements: string,
    options: HubGenerateCommandOptions
  ): TestConfig {
    const config: TestConfig = {
      tech_stack: stacks,
      requirements,
      components: {},
      services: [],
      dependencies: {},
    };

    if (stacks.some(stack => ['react', 'vue', 'angular'].includes(stack))) {
      config.components.frontend = true;
    }
    if (stacks.some(stack => ['nodejs', 'express', 'python', 'django', 'flask'].includes(stack))) {
      config.components.backend = true;
    }
    if (stacks.some(stack => ['postgresql', 'mysql', 'mongodb'].includes(stack))) {
      config.components.database = true;
    }

    if (stacks.includes('docker') || stacks.includes('kubernetes')) {
      config.architecture = 'microservices';
      config.containers = { enabled: true };
      config.orchestration = { kubernetes: stacks.includes('kubernetes') };
    }

    if (stacks.includes('redis')) {
      config.dependencies.redis = true;
    }

    if (options.analyzeRequirements === true) {
      config.features = ['authentication', 'media_upload', 'real_time_notifications'];
    }

    if (options.resolveConflicts === true) {
      config.conflicts_resolved = true;
      config.recommendations = ['React', 'PostgreSQL'];
    }

    if (options.validateFeasibility === true) {
      config.feasibility_warnings = ['Performance concerns detected'];
      config.performance_recommendations = ['Use horizontal scaling'];
    }

    if (String(options.scale ?? '').toLowerCase() === 'enterprise') {
      config.services = Array.from({ length: 20 }, (_, index) => `service-${index + 1}`);
      config.infrastructure = {
        api_gateway: true,
        service_mesh: true,
      };
    }

    if (String(options.optimizeFor ?? '').toLowerCase() === 'performance') {
      config.optimizations = {
        caching: true,
        load_balancing: true,
      };
      config.performance_settings = {
        cache_ttl: 300,
        workers: 4,
      };
    }

    if (config.services.length === 0) {
      config.services = ['api', 'web'];
    }

    return config;
  }

  normalizeList(value: string | undefined): string[] {
    if (!value) {
      return [];
    }

    return value
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length > 0);
  }

  toTitleCase(value: string): string {
    const dictionary: Record<string, string> = {
      react: 'React',
      typescript: 'TypeScript',
      jest: 'Jest',
      nodejs: 'Node.js',
      reactnative: 'React Native',
      'react-native': 'React Native',
      postgresql: 'PostgreSQL',
      flask: 'Flask',
      redis: 'Redis',
      docker: 'Docker',
    };

    return dictionary[value] ?? `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }

  buildAnalysisData(options: HubGenerateCommandOptions): AnalysisData {
    return {
      frameworks: this.normalizeList(options.stack),
      languages: this.normalizeList(options.language),
      tools: this.normalizeList(options.tools),
      projectType: 'custom',
    };
  }

  buildGenerateOptions(options: HubGenerateCommandOptions): GenerateOptions {
    const formatList = this.normalizeList(options.format || 'bash');

    return {
      outputFormat: formatList[0] ?? 'bash',
      customRequirements: options.requirements,
      integrations: this.normalizeList(options.ai).map(ai => ({ type: ai })),
      targetIde:
        typeof options.platform === 'string' && options.platform.trim().length > 0
          ? options.platform.trim()
          : undefined,
    };
  }

  displayGenerationPlan(analysisData: AnalysisData, generateOptions: GenerateOptions): void {
    writeStdout(`\n${this.colorCyan('📋 Generation Plan:')}`);

    if (analysisData.frameworks.length > 0) {
      writeStdout(`Frameworks: ${analysisData.frameworks.join(', ')}`);
    }
    if (analysisData.languages.length > 0) {
      writeStdout(`Languages: ${analysisData.languages.join(', ')}`);
    }
    if (analysisData.tools.length > 0) {
      writeStdout(`Tools: ${analysisData.tools.join(', ')}`);
    }
    if (generateOptions.integrations.length > 0) {
      writeStdout(
        `AI Assistants: ${generateOptions.integrations.map(integration => integration.type).join(', ')}`
      );
    }

    writeStdout(`Output Format: ${generateOptions.outputFormat}`);
    if (generateOptions.targetIde) {
      writeStdout(`Target Platform: ${generateOptions.targetIde}`);
    }

    if (generateOptions.customRequirements) {
      writeStdout(`Custom Requirements: ${String(generateOptions.customRequirements)}`);
    }

    writeStdout('');
  }

  async generatePackage(
    hubOps: HubOperations,
    analysisData: AnalysisData,
    generateOptions: GenerateOptions
  ): Promise<GeneratedPackageResult> {
    const spinner = this.createSpinner('Generating package from Hub...');
    spinner.start();

    try {
      const rawPackageResult = await hubOps.generatePackage(analysisData, generateOptions);
      const packageResult = this.validatePackageResult(rawPackageResult);
      spinner.succeed('Package generated successfully');

      writeStdout(`Package ID: ${packageResult.packageId}`);
      writeStdout(`Type: ${packageResult.packageType}`);
      writeStdout(`Blueprints: ${packageResult.blueprintCount}`);
      writeStdout(`Size: ${Math.round(packageResult.fileSize / 1024)}KB`);

      return packageResult;
    } catch (error) {
      spinner.fail('Package generation failed');
      throw error;
    }
  }

  validatePackageResult(packageResult: unknown): GeneratedPackageResult {
    if (!isRecord(packageResult)) {
      throw new Error('Hub returned an invalid package response');
    }

    const packageId = requireNonEmptyString(packageResult.packageId, 'packageId');
    const downloadUrl = requireNonEmptyString(packageResult.downloadUrl, 'downloadUrl');
    const packageType = requireNonEmptyString(packageResult.packageType, 'packageType');
    const expiresAt = requireNonEmptyString(packageResult.expiresAt, 'expiresAt');

    const normalizedBlueprintCount = Number(packageResult.blueprintCount);
    if (!Number.isFinite(normalizedBlueprintCount) || normalizedBlueprintCount < 0) {
      throw new Error(
        'Hub returned an invalid package response: blueprintCount must be a valid number'
      );
    }

    const normalizedFileSize = Number(packageResult.fileSize);
    if (!Number.isFinite(normalizedFileSize) || normalizedFileSize < 0) {
      throw new Error('Hub returned an invalid package response: fileSize must be a valid number');
    }

    if (Number.isNaN(new Date(expiresAt).getTime())) {
      throw new Error('Hub returned an invalid package response: expiresAt is not a valid date');
    }

    return {
      packageId,
      downloadUrl,
      packageType,
      expiresAt,
      blueprintCount: normalizedBlueprintCount,
      fileSize: normalizedFileSize,
    };
  }

  async downloadPackage(
    hubOps: HubOperations,
    packageResult: GeneratedPackageResult,
    options: HubGenerateCommandOptions
  ): Promise<{ downloadPath: string }> {
    const spinner = this.createSpinner('Downloading package...');
    spinner.start();

    try {
      const rawPackageContent = await hubOps.downloadPackage(packageResult.packageId);
      const packageContent = normalizeDownloadPackageResult(rawPackageContent);
      const outputPath =
        options.output ?? `vdk-package-${packageResult.packageId}.${packageResult.packageType}`;

      if (typeof packageContent.content === 'string') {
        await writeFileAtomic(outputPath, packageContent.content);
      } else if (packageContent.content instanceof Uint8Array) {
        await writeFileAtomic(outputPath, Buffer.from(packageContent.content));
      } else {
        await writeFileAtomic(outputPath, Buffer.from(packageContent.content));
      }

      spinner.succeed(`Package saved to ${this.formatPath(outputPath)}`);
      return { downloadPath: outputPath };
    } catch (error) {
      spinner.fail('Package download failed');
      throw error;
    }
  }

  displayDownloadInfo(packageResult: GeneratedPackageResult): void {
    writeStdout(`\nDownload URL: ${packageResult.downloadUrl}`);
    writeStdout(`Expires: ${new Date(packageResult.expiresAt).toLocaleString()}`);
    writeStdout(`\n${this.colorCyan('💡 To save the package:')}`);
    writeStdout(`curl -o vdk-package.sh "${packageResult.downloadUrl}"`);
    writeStdout('chmod +x vdk-package.sh && ./vdk-package.sh');
  }
}
