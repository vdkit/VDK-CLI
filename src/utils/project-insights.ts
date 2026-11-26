/**
 * Project insights for blueprint rule artifacts.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import glob from 'fast-glob';
import matter from 'gray-matter';
import { z } from 'zod';

const DEFAULT_PROJECT_ROOT = process.cwd();
const DEFAULT_RULES_DIRECTORY = '.vdk/blueprints/rules';
const RULE_FILE_PATTERNS = ['**/*.md', '**/*.mdc'];
const RULE_FILE_IGNORE_PATTERNS = ['**/README.md', '**/CONTRIBUTING.md', '**/CHANGELOG.md'];

const modulePath = fileURLToPath(import.meta.url);

const ruleTypesSchema = z.strictObject({
  context: z.boolean(),
  errorHandling: z.boolean(),
  framework: z.boolean(),
  language: z.boolean(),
  mcpConfig: z.boolean(),
});

const baseInsightsSchema = z.strictObject({
  frameworks: z.array(z.string()),
  hasRules: z.boolean(),
  languages: z.array(z.string()),
  lastUpdated: z.string().nullable(),
  projectSize: z.enum(['small', 'medium', 'large', 'unknown']),
  recommendations: z.array(z.string()),
  rulesCount: z.number().int().nonnegative(),
  ruleTypes: ruleTypesSchema,
  technologies: z.array(z.string()),
});

const successfulInsightsSchema = baseInsightsSchema.extend({
  error: z.undefined().optional(),
  hasRules: z.literal(true),
});

const missingInsightsSchema = baseInsightsSchema.extend({
  error: z.string().min(1),
  hasRules: z.literal(false),
});

const projectInsightsSchema = z.union([successfulInsightsSchema, missingInsightsSchema]);

type ProjectInsightsCliOptions = {
  json: boolean;
};

type KeywordMap = ReadonlyMap<string, RegExp>;

export type ProjectInsights = z.infer<typeof projectInsightsSchema>;

const frameworkPatterns: KeywordMap = new Map<string, RegExp>([
  ['Angular', /\bAngular\b/i],
  ['Django', /\bDjango\b/i],
  ['Express', /\bExpress\b/i],
  ['Next.js', /\bNext\.js\b/i],
  ['Nuxt', /\bNuxt\b/i],
  ['React', /\bReact\b/i],
  ['Svelte', /\bSvelte\b/i],
  ['Vue', /\bVue\b/i],
]);

const languagePatterns: KeywordMap = new Map<string, RegExp>([
  ['Go', /\bGo\b/i],
  ['Java', /\bJava\b/i],
  ['JavaScript', /\bJavaScript\b/i],
  ['Python', /\bPython\b/i],
  ['TypeScript', /\bTypeScript\b/i],
]);

const technologyPatterns: KeywordMap = new Map<string, RegExp>([
  ['Docker', /\bDocker\b/i],
  ['Node.js', /\bNode\.js\b/i],
  ['PostgreSQL', /\bPostgreSQL\b/i],
  ['Supabase', /\bSupabase\b/i],
  ['Tailwind CSS', /\bTailwind\b/i],
  ['Vercel', /\bVercel\b/i],
  ['Vitest', /\bVitest\b/i],
  ['Zod', /\bZod\b/i],
]);

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }

  return path.resolve(process.argv[1]) === modulePath;
}

function normalizeArgv(argv: string[]): string[] {
  if (argv[2] === '--') {
    return [argv[0], argv[1], ...argv.slice(3)];
  }

  return argv;
}

async function collectRuleFiles(rulesDirectory: string): Promise<string[]> {
  return await glob(RULE_FILE_PATTERNS, {
    absolute: true,
    cwd: rulesDirectory,
    ignore: RULE_FILE_IGNORE_PATTERNS,
    onlyFiles: true,
  });
}

function addMatches(targetSet: Set<string>, haystack: string, patterns: KeywordMap): void {
  for (const [label, pattern] of patterns) {
    if (pattern.test(haystack)) {
      targetSet.add(label);
    }
  }
}

function getRuleCategory(filePath: string, fileContent: string): z.infer<typeof ruleTypesSchema> {
  const normalizedPath = filePath.toLowerCase();
  const normalizedContent = fileContent.toLowerCase();

  return {
    context:
      normalizedPath.includes('context') ||
      normalizedPath.includes('project-context') ||
      normalizedContent.includes('project context'),
    errorHandling:
      normalizedPath.includes('error') ||
      normalizedContent.includes('error handling') ||
      normalizedContent.includes('common errors'),
    framework:
      normalizedPath.includes('framework') ||
      Array.from(frameworkPatterns.values()).some(pattern => pattern.test(fileContent)),
    language:
      normalizedPath.includes('language') ||
      Array.from(languagePatterns.values()).some(pattern => pattern.test(fileContent)),
    mcpConfig:
      normalizedPath.includes('mcp') ||
      normalizedContent.includes('mcp') ||
      normalizedContent.includes('model context protocol'),
  };
}

function estimateProjectSize(
  ruleCount: number,
  frameworkCount: number,
  technologyCount: number
): 'large' | 'medium' | 'small' {
  if (ruleCount >= 8 || frameworkCount >= 3 || technologyCount >= 6) {
    return 'large';
  }

  if (ruleCount >= 4 || frameworkCount >= 1 || technologyCount >= 3) {
    return 'medium';
  }

  return 'small';
}

function buildRecommendations(insights: ProjectInsights): string[] {
  if (!insights.hasRules) {
    return [insights.error];
  }

  const recommendations: string[] = [];

  if (!insights.ruleTypes.context) {
    recommendations.push('Add a project context rule so generated guidance stays grounded.');
  }

  if (!insights.ruleTypes.errorHandling) {
    recommendations.push(
      'Add an error-handling rule so operational failures are covered explicitly.'
    );
  }

  if (insights.frameworks.length > 0 && !insights.ruleTypes.framework) {
    recommendations.push(
      'Add framework-specific rules for the stack already referenced in your artifacts.'
    );
  }

  if (insights.languages.length > 0 && !insights.ruleTypes.language) {
    recommendations.push('Add language-specific rules to cover coding conventions and tooling.');
  }

  if (insights.frameworks.length > 0 && !insights.ruleTypes.mcpConfig) {
    recommendations.push(
      'Add an MCP configuration rule if the project depends on editor integration.'
    );
  }

  if (insights.rulesCount < 3) {
    recommendations.push(
      'The rule set is still small; add more focused artifacts for the main workflows.'
    );
  }

  return recommendations;
}

export async function generateProjectInsights(
  projectPath = DEFAULT_PROJECT_ROOT
): Promise<ProjectInsights> {
  const resolvedProjectPath = path.resolve(projectPath);
  const rulesDirectory = path.join(resolvedProjectPath, DEFAULT_RULES_DIRECTORY);
  const files = await collectRuleFiles(rulesDirectory);

  if (files.length === 0) {
    return projectInsightsSchema.parse({
      error: `No blueprint rules found under ${rulesDirectory}.`,
      frameworks: [],
      hasRules: false,
      languages: [],
      lastUpdated: null,
      projectSize: 'unknown',
      recommendations: [`No blueprint rules found under ${rulesDirectory}.`],
      rulesCount: 0,
      ruleTypes: {
        context: false,
        errorHandling: false,
        framework: false,
        language: false,
        mcpConfig: false,
      },
      technologies: [],
    });
  }

  const frameworks = new Set<string>();
  const languages = new Set<string>();
  const technologies = new Set<string>();
  const ruleTypes = {
    context: false,
    errorHandling: false,
    framework: false,
    language: false,
    mcpConfig: false,
  };

  let latestUpdateTimestamp = 0;
  let latestUpdateIsoString: string | null = null;

  for (const filePath of files) {
    const [fileContent, fileStats] = await Promise.all([
      readFile(filePath, 'utf8'),
      stat(filePath),
    ]);
    const parsedMatter = matter(fileContent);
    const searchableContent = `${filePath}\n${JSON.stringify(parsedMatter.data)}\n${parsedMatter.content}`;
    const matchedRuleTypes = getRuleCategory(filePath, searchableContent);

    addMatches(frameworks, searchableContent, frameworkPatterns);
    addMatches(languages, searchableContent, languagePatterns);
    addMatches(technologies, searchableContent, technologyPatterns);

    ruleTypes.context ||= matchedRuleTypes.context;
    ruleTypes.errorHandling ||= matchedRuleTypes.errorHandling;
    ruleTypes.framework ||= matchedRuleTypes.framework;
    ruleTypes.language ||= matchedRuleTypes.language;
    ruleTypes.mcpConfig ||= matchedRuleTypes.mcpConfig;

    const modifiedTime = fileStats.mtime.getTime();
    if (modifiedTime > latestUpdateTimestamp) {
      latestUpdateTimestamp = modifiedTime;
      latestUpdateIsoString = fileStats.mtime.toISOString();
    }
  }

  const insights = projectInsightsSchema.parse({
    frameworks: Array.from(frameworks).toSorted((left, right) => left.localeCompare(right)),
    hasRules: true,
    languages: Array.from(languages).toSorted((left, right) => left.localeCompare(right)),
    lastUpdated: latestUpdateIsoString,
    projectSize: estimateProjectSize(files.length, frameworks.size, technologies.size),
    recommendations: [],
    rulesCount: files.length,
    ruleTypes,
    technologies: Array.from(technologies).toSorted((left, right) => left.localeCompare(right)),
  });

  return projectInsightsSchema.parse({
    ...insights,
    recommendations: buildRecommendations(insights),
  });
}

function renderProjectInsights(insights: ProjectInsights): void {
  if (!insights.hasRules) {
    writeStdout(chalk.yellow(insights.error));
    return;
  }

  writeStdout(chalk.blue.bold('Project insights'));
  writeStdout(chalk.green(`Rules count: ${insights.rulesCount}`));
  writeStdout(chalk.green(`Project size: ${insights.projectSize}`));
  writeStdout(
    chalk.green(`Last updated: ${insights.lastUpdated === null ? 'Unknown' : insights.lastUpdated}`)
  );

  if (insights.languages.length > 0) {
    writeStdout(chalk.cyan(`Languages: ${insights.languages.join(', ')}`));
  }

  if (insights.frameworks.length > 0) {
    writeStdout(chalk.cyan(`Frameworks: ${insights.frameworks.join(', ')}`));
  }

  if (insights.technologies.length > 0) {
    writeStdout(chalk.cyan(`Technologies: ${insights.technologies.join(', ')}`));
  }

  writeStdout('');
  writeStdout(chalk.yellow('Rule coverage'));
  writeStdout(`  Context: ${insights.ruleTypes.context ? 'yes' : 'no'}`);
  writeStdout(`  Framework: ${insights.ruleTypes.framework ? 'yes' : 'no'}`);
  writeStdout(`  Language: ${insights.ruleTypes.language ? 'yes' : 'no'}`);
  writeStdout(`  Error handling: ${insights.ruleTypes.errorHandling ? 'yes' : 'no'}`);
  writeStdout(`  MCP config: ${insights.ruleTypes.mcpConfig ? 'yes' : 'no'}`);

  if (insights.recommendations.length > 0) {
    writeStdout('');
    writeStdout(chalk.yellow('Recommendations'));

    for (const recommendation of insights.recommendations) {
      writeStdout(`  - ${recommendation}`);
    }
  }
}

async function runProjectInsightsCli(
  projectPath: string,
  options: ProjectInsightsCliOptions
): Promise<number> {
  const insights = await generateProjectInsights(projectPath);

  if (options.json) {
    writeStdout(JSON.stringify(insights, null, 2));
  } else {
    renderProjectInsights(insights);
  }

  return 0;
}

export async function runProjectInsightsCliFromArgv(
  argv: string[] = process.argv
): Promise<number> {
  const normalizedArgv = normalizeArgv(argv);
  const program = new Command()
    .name('project-insights')
    .description('Summarize the blueprint rule artifacts found in a project')
    .showHelpAfterError('(add --help for usage information)')
    .argument('[path]', 'Path to the project root', DEFAULT_PROJECT_ROOT)
    .option('--json', 'Output the insights as JSON', false)
    .configureOutput({
      writeErr: writeStderr,
      writeOut: writeStdout,
    })
    .exitOverride();

  try {
    await program.parseAsync(normalizedArgv);
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 1 ? 2 : error.exitCode;
    }

    throw error;
  }

  const projectPath = z.string().parse(program.processedArgs[0] ?? DEFAULT_PROJECT_ROOT);
  return await runProjectInsightsCli(projectPath, program.opts<ProjectInsightsCliOptions>());
}

if (isMainModule()) {
  runProjectInsightsCliFromArgv().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      writeStderr(chalk.red(`Project insights failed: ${formatError(error)}`));
      process.exitCode = 1;
    }
  );
}
