/**
 * BaseCommand
 * -----------------------
 * Base class for all VDK CLI commands providing shared functionality,
 * consistent error handling, and common utilities.
 */

import path from 'node:path';
import type { Ora } from 'ora';

import { isHubAvailable, quickHubOperations } from '../../hub/index.js';
import { boxes, colors, format, headers, spinners, status } from '../../utils/cli-styles.js';
import { validators } from '../../utils/schema-validator.js';
import { commandContext } from '../shared/CommandContext.js';

type PrimitiveFieldType = 'array' | 'boolean' | 'number' | 'object' | 'string';
type FormatType = 'email' | 'json' | 'platform' | 'ruleId' | 'semver' | 'url';
type PathType = 'directory' | 'file' | 'writeable';

export type CommandOptions = Record<string, unknown> & {
  verbose?: boolean;
};

type ValidationPathResult = {
  error?: string;
  valid: boolean;
};

type ValidationFieldRule = {
  enum?: readonly (boolean | number | string)[];
  format?: FormatType;
  pathType?: PathType;
  type?: PrimitiveFieldType;
  validate?: (
    value: unknown,
    options: CommandOptions
  ) => Promise<boolean | string> | boolean | string;
  warn?: (
    value: unknown,
    options: CommandOptions
  ) => Promise<boolean | string | undefined> | boolean | string | undefined;
};

export type ValidationRules = {
  crossValidation?: (
    options: CommandOptions
  ) => Promise<string[] | string | true> | string[] | string | true;
  defaults?: Record<string, unknown>;
  fields?: Record<string, ValidationFieldRule>;
  required?: string[];
};

type ValidationResult = {
  valid: true;
  warnings: string[];
};

export type HubConnectivityResult = {
  capabilities?: Record<string, boolean>;
  error?: string;
  features?: string[];
  latency?: number;
  limits?: Record<string, number | string | undefined>;
  success: boolean;
  version?: string;
};

export type HubSessionSnapshot = {
  sessionId: string;
  uptime: number;
} & Record<string, unknown>;

export type HubStatusSnapshot = {
  hubConnected: boolean;
  initialized: boolean;
  telemetryEnabled: boolean;
} & Record<string, unknown>;

export type HubOperations = {
  checkCompatibility?: () => Promise<unknown>;
  deployBlueprints?: (
    project: Record<string, unknown>,
    blueprints: unknown[],
    options: Record<string, unknown>
  ) => Promise<unknown>;
  downloadPackage?: (packageId: string, outputPath?: string) => Promise<unknown>;
  generatePackage?: (
    analysis: Record<string, unknown>,
    options: Record<string, unknown>
  ) => Promise<unknown>;
  getCommunityBlueprint?: (id: string) => Promise<unknown>;
  getCommunityCategories?: () => Promise<unknown>;
  getHeartbeatSummary?: (options: Record<string, unknown>) => Promise<unknown>;
  getRecommendations?: (analysis: Record<string, unknown>) => Promise<unknown>;
  getSession?: () => HubSessionSnapshot | null;
  getStatus?: () => HubStatusSnapshot;
  getTrendingBlueprints?: (options: Record<string, unknown>) => Promise<unknown>;
  searchCommunityBlueprints?: (criteria: Record<string, unknown>) => Promise<unknown>;
  shutdown?: () => Promise<void> | void;
  syncBlueprints?: (options: Record<string, unknown>) => Promise<unknown>;
  testConnection?: () => Promise<HubConnectivityResult>;
  trackCommand: (command: string, metadata: Record<string, unknown>) => string | null;
  trackError: (command: string, error: Error, metadata: Record<string, unknown>) => void;
  trackCommunityBlueprintUsage?: (id: string, usage: Record<string, unknown>) => Promise<unknown>;
  trackIntegrations?: (integrations: string[]) => void;
};

type LoggedError = Error & {
  exitCode?: number;
  logged?: boolean;
};

type SchemaValidators = Record<FormatType, (value: string) => boolean>;
type CliStatus = Record<'error' | 'info' | 'success' | 'warning', (message: string) => string>;
type CliHeaders = {
  section: (message: string) => string;
};
type CliBoxes = {
  error: (message: string) => string;
};
type CliFormat = {
  count: (value: number) => string;
  keyValue: (key: string, value: unknown) => string;
  path: (value: string) => string;
};
type CliColors = {
  primary: (value: string) => string;
};
type CliSpinners = {
  scanning: (text: string) => Ora;
};

const schemaValidators: SchemaValidators = validators;
const cliStatus: CliStatus = status;
const cliHeaders: CliHeaders = headers;
const cliBoxes: CliBoxes = boxes;
const cliFormat: CliFormat = format;
const cliColors: CliColors = colors;
const cliSpinners: CliSpinners = spinners;

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isLoggedError(error: unknown): error is LoggedError {
  return error instanceof Error && 'logged' in error && error.logged === true;
}

export class BaseCommand {
  readonly description: string;
  readonly name: string;
  hubOps: HubOperations | null = null;
  sessionId: string | null = null;
  startTime: number | null = null;
  verbose = false;

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  /**
   * Initialize common command setup
   */
  async initialize(options: CommandOptions = {}): Promise<void> {
    this.verbose = options.verbose === true;

    // Initialize Hub integration if available
    try {
      const hubAvailable = await isHubAvailable();
      if (hubAvailable) {
        const hubOperations: HubOperations = await quickHubOperations();
        this.hubOps = hubOperations;
        this.sessionId = this.hubOps.trackCommand(this.name, {
          startTime: Date.now(),
          options,
        });
      }
    } catch {
      if (this.verbose) {
        this.logWarning('Hub integration unavailable, using local features');
      }
    }
  }

  /**
   * Track successful command completion with Hub
   */
  trackSuccess(metadata: Record<string, unknown> = {}): void {
    if (this.hubOps && this.sessionId) {
      this.hubOps.trackCommand(this.name, {
        sessionId: this.sessionId,
        success: true,
        executionTime: Date.now() - (this.startTime || Date.now()),
        ...metadata,
      });
    }
  }

  /**
   * Track command error with Hub
   */
  trackError(error: Error, metadata: Record<string, unknown> = {}): void {
    if (this.hubOps !== null && this.sessionId !== null) {
      this.hubOps.trackError(this.name, error, {
        sessionId: this.sessionId,
        ...metadata,
      });
    }
  }

  /**
   * Display section header
   */
  showHeader(title: string | null = null): void {
    writeStdout(cliHeaders.section(title ?? this.description));
  }

  /**
   * Create and start a spinner
   */
  createSpinner(text: string): Ora {
    return cliSpinners.scanning(text);
  }

  /**
   * Consistent success logging
   */
  logSuccess(message: string): void {
    writeStdout(cliStatus.success(message));
  }

  /**
   * Consistent info logging
   */
  logInfo(message: string): void {
    writeStdout(cliStatus.info(message));
  }

  /**
   * Consistent warning logging
   */
  logWarning(message: string): void {
    writeStdout(cliStatus.warning(message));
  }

  /**
   * Consistent error logging
   */
  logError(message: string): void {
    writeStderr(cliStatus.error(message));
  }

  /**
   * Display error box and exit
   */
  exitWithError(message: string, error: Error | null = null): never {
    writeStderr(cliBoxes.error(message));

    const loggedError: LoggedError = error ?? new Error(message);
    loggedError.logged = true;
    loggedError.exitCode = typeof loggedError.exitCode === 'number' ? loggedError.exitCode : 1;

    if (error) {
      this.trackError(loggedError);
      if (this.verbose && loggedError.stack) {
        writeStderr(loggedError.stack);
      }
    }

    throw loggedError;
  }

  /**
   * Unified validation framework for command options
   */
  async validateOptions(
    options: CommandOptions,
    validationRules: ValidationRules = {}
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Apply defaults if specified
    if (validationRules.defaults) {
      for (const [key, defaultValue] of Object.entries(validationRules.defaults)) {
        if (options[key] === undefined || options[key] === null) {
          options[key] = defaultValue;
        }
      }
    }

    // Check required fields
    if (validationRules.required) {
      for (const field of validationRules.required) {
        const fieldValue = options[field];
        if (!fieldValue && fieldValue !== 0 && fieldValue !== false) {
          errors.push(`Missing required option: --${field}`);
        }
      }
    }

    // Validate field types and formats
    if (validationRules.fields) {
      for (const [field, rules] of Object.entries(validationRules.fields)) {
        const value = options[field];

        // Skip validation if field is not provided and not required
        if (value === undefined || value === null) continue;

        // Type validation
        if (rules.type) {
          if (!this.validateFieldType(value, rules.type)) {
            errors.push(`Invalid type for --${field}: expected ${rules.type}`);
            continue;
          }
        }

        // Format validation using validators
        if (rules.format) {
          const isValid = await this.validateFieldFormat(value, rules.format);
          if (!isValid) {
            errors.push(`Invalid format for --${field}: expected ${rules.format}`);
            continue;
          }
        }

        // Enum validation
        if (rules.enum) {
          if (!rules.enum.some(entry => Object.is(entry, value))) {
            errors.push(`Invalid value for --${field}: must be one of [${rules.enum.join(', ')}]`);
            continue;
          }
        }

        // Path validation
        if (rules.pathType) {
          const pathValid = await this.validatePath(value, rules.pathType);
          if (!pathValid.valid) {
            errors.push(`Invalid path for --${field}: ${pathValid.error}`);
            continue;
          }
        }

        // Custom validation function
        if (rules.validate && typeof rules.validate === 'function') {
          try {
            const customResult = await rules.validate(value, options);
            if (customResult !== true) {
              errors.push(`Validation failed for --${field}: ${customResult || 'Invalid value'}`);
            }
          } catch (error) {
            errors.push(`Validation error for --${field}: ${getErrorMessage(error)}`);
          }
        }

        // Warning checks
        if (rules.warn && typeof rules.warn === 'function') {
          try {
            const warnResult = await rules.warn(value, options);
            if (warnResult !== true && warnResult) {
              warnings.push(`Warning for --${field}: ${warnResult}`);
            }
          } catch (error) {
            warnings.push(`Warning check failed for --${field}: ${getErrorMessage(error)}`);
          }
        }
      }
    }

    // Cross-field validation
    if (validationRules.crossValidation && typeof validationRules.crossValidation === 'function') {
      try {
        const crossResult = await validationRules.crossValidation(options);
        if (crossResult !== true && crossResult) {
          if (Array.isArray(crossResult)) {
            errors.push(...crossResult);
          } else {
            errors.push(crossResult);
          }
        }
      } catch (error) {
        errors.push(`Cross-validation error: ${getErrorMessage(error)}`);
      }
    }

    // Show warnings if any
    if (warnings.length > 0 && this.verbose) {
      warnings.forEach(warning => this.logWarning(warning));
    }

    // Exit with errors if validation failed
    if (errors.length > 0) {
      const errorMessage = `Validation failed:\n${errors.map(err => `  • ${err}`).join('\n')}\n\nUse --help for usage information`;
      this.exitWithError(errorMessage);
    }

    return { valid: true, warnings };
  }

  /**
   * Validate field type
   * @private
   */
  validateFieldType(value: unknown, expectedType: PrimitiveFieldType): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !Number.isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true;
    }
  }

  /**
   * Validate field format using validators
   * @private
   */
  async validateFieldFormat(value: unknown, formatType: FormatType): Promise<boolean> {
    if (typeof value !== 'string') {
      return false;
    }

    switch (formatType) {
      case 'email':
        return schemaValidators.email(value);
      case 'url':
        return schemaValidators.url(value);
      case 'json':
        return schemaValidators.json(value);
      case 'semver':
        return schemaValidators.semver(value);
      case 'ruleId':
        return schemaValidators.ruleId(value);
      case 'platform':
        return schemaValidators.platform(value);
      default:
        return true;
    }
  }

  /**
   * Validate path existence and type
   * @private
   */
  async validatePath(pathValue: unknown, pathType: PathType): Promise<ValidationPathResult> {
    if (typeof pathValue !== 'string') {
      return {
        valid: false,
        error: 'Path value must be a string',
      };
    }

    try {
      switch (pathType) {
        case 'file': {
          const fileExists = await commandContext.pathExists(pathValue);
          if (!fileExists) {
            return { valid: false, error: `File does not exist: ${pathValue}` };
          }
          return { valid: true };
        }

        case 'directory': {
          const dirExists = await commandContext.pathExists(pathValue);
          if (!dirExists) {
            return { valid: false, error: `Directory does not exist: ${pathValue}` };
          }
          return { valid: true };
        }

        case 'writeable': {
          // Allow creation of nested output directories by validating the nearest existing ancestor.
          // Example: ./.vdk/blueprints/rules should be valid even when .vdk does not exist yet.
          const resolvedTarget = commandContext.resolvePath(pathValue);
          let candidate = path.dirname(resolvedTarget);

          while (true) {
            const exists = await commandContext.pathExists(candidate);
            if (exists) {
              return { valid: true };
            }

            const parent = path.dirname(candidate);
            if (parent === candidate) {
              break;
            }
            candidate = parent;
          }

          return {
            valid: false,
            error: `No writable ancestor directory exists for: ${resolvedTarget}`,
          };
        }

        default:
          return { valid: true };
      }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Format file paths consistently
   */
  formatPath(pathValue: string): string {
    return cliFormat.path(pathValue);
  }

  /**
   * Format key-value pairs consistently
   */
  formatKeyValue(key: string, value: unknown): string {
    return cliFormat.keyValue(key, value);
  }

  /**
   * Format counts consistently
   */
  formatCount(count: number): string {
    return cliFormat.count(count);
  }

  /**
   * Color primary text
   */
  colorPrimary(text: string): string {
    return cliColors.primary(text);
  }

  /**
   * Color cyan text
   */
  colorCyan(text: string): string {
    return cliColors.primary(text); // Using primary (cyan) color
  }

  /**
   * Abstract method - must be implemented by subclasses
   */
  async execute(_options: CommandOptions): Promise<unknown> {
    throw new Error(`Command ${this.name} must implement execute() method`);
  }

  /**
   * Command runner with error handling
   */
  async run(options: CommandOptions): Promise<unknown> {
    this.startTime = Date.now();

    try {
      await this.initialize(options);
      const result = await this.execute(options);
      this.trackSuccess();
      return result;
    } catch (error) {
      const commandError = error instanceof Error ? error : new Error(String(error));
      this.trackError(commandError);

      // Don't double-log errors that are already handled by individual commands
      if (!isLoggedError(commandError)) {
        this.exitWithError(`${this.description} failed: ${commandError.message}`, commandError);
      } else {
        throw commandError;
      }
    }
  }
}
