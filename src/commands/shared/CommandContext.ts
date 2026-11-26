/**
 * CommandContext
 * -----------------------
 * Shared context and utilities for all VDK CLI commands.
 * Provides consistent environment setup and common dependencies.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

import { createIntegrationManager } from '../../integrations/index.js';
import type { IntegrationManager as RuntimeIntegrationManager } from '../../integrations/integration-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageInfoSchema = z.object({
  version: z.string().min(1),
});

type PackageInfo = z.infer<typeof packageInfoSchema>;
type JsonObject = Record<string, unknown>;
type IntegrationManager = RuntimeIntegrationManager;

type FileSystemService = {
  access: typeof fs.access;
  mkdir: typeof fs.mkdir;
  readdir: typeof fs.readdir;
  readFile: typeof fs.readFile;
  writeFile: typeof fs.writeFile;
};

type PathService = {
  dirname: typeof path.dirname;
  join: typeof path.join;
  relative: typeof path.relative;
  resolve: typeof path.resolve;
};

type EnvironmentService = {
  cwd: () => string;
  loadConfig: (configPath: string) => void;
};

type ServiceValue = object;
type ServiceFactory = () => ServiceValue;
type RegisteredService = {
  factory: ServiceFactory;
  singleton: boolean;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isFileSystemService(value: object): value is FileSystemService {
  return 'access' in value && 'mkdir' in value && 'readdir' in value && 'readFile' in value;
}

function isPathService(value: object): value is PathService {
  return 'dirname' in value && 'join' in value && 'relative' in value && 'resolve' in value;
}

function isEnvironmentService(value: object): value is EnvironmentService {
  return 'cwd' in value && 'loadConfig' in value;
}

/**
 * Service container for dependency injection
 */
class ServiceContainer {
  readonly services = new Map<string, RegisteredService>();
  private readonly singletons = new Map<string, ServiceValue>();

  register(name: string, factory: ServiceFactory, singleton = false): void {
    this.services.set(name, { factory, singleton });
  }

  resolve(name: string): ServiceValue {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' not found`);
    }

    if (service.singleton) {
      if (!this.singletons.has(name)) {
        const singletonValue = service.factory();
        if (!isObject(singletonValue)) {
          throw new Error(`Service '${name}' must resolve to an object`);
        }
        this.singletons.set(name, singletonValue);
      }
      return this.singletons.get(name) ?? {};
    }

    const resolvedValue = service.factory();
    if (!isObject(resolvedValue)) {
      throw new Error(`Service '${name}' must resolve to an object`);
    }

    return resolvedValue;
  }

  clear(): void {
    this.singletons.clear();
  }
}

export class CommandContext {
  private cliDir: string | null = null;
  private initialized = false;
  private integrationManager: IntegrationManager | null = null;
  private packageInfo: PackageInfo | null = null;
  private readonly services: ServiceContainer;

  constructor(serviceContainer: ServiceContainer | null = null) {
    this.services = serviceContainer ?? new ServiceContainer();

    // Register default services
    this._registerDefaultServices();
  }

  /**
   * Register default services in the container
   * @private
   */
  _registerDefaultServices(): void {
    // File system service
    this.services.register(
      'fileSystem',
      (): FileSystemService => ({
        readFile: fs.readFile,
        writeFile: fs.writeFile,
        access: fs.access,
        mkdir: fs.mkdir,
        readdir: fs.readdir,
      }),
      true
    );

    // Path service
    this.services.register(
      'pathService',
      (): PathService => ({
        resolve: path.resolve,
        join: path.join,
        relative: path.relative,
        dirname: path.dirname,
      }),
      true
    );

    // Environment service
    this.services.register(
      'environment',
      (): EnvironmentService => ({
        loadConfig: (configPath: string) => {
          dotenv.config({ path: configPath, quiet: true });
        },
        cwd: () => process.cwd(),
      }),
      true
    );
  }

  private resolveFileSystem(): FileSystemService {
    const fileSystem = this.services.resolve('fileSystem');
    if (!isFileSystemService(fileSystem)) {
      throw new Error('The fileSystem service is not valid');
    }

    return fileSystem;
  }

  private resolvePathService(): PathService {
    const pathService = this.services.resolve('pathService');
    if (!isPathService(pathService)) {
      throw new Error('The pathService service is not valid');
    }

    return pathService;
  }

  private resolveEnvironmentService(): EnvironmentService {
    const environmentService = this.services.resolve('environment');
    if (!isEnvironmentService(environmentService)) {
      throw new Error('The environment service is not valid');
    }

    return environmentService;
  }

  /**
   * Initialize the command context
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const pathService = this.resolvePathService();
      const environment = this.resolveEnvironmentService();

      // Get CLI directory (VDK CLI root)
      this.cliDir = pathService.resolve(__dirname, '../../..');

      // Load environment variables
      environment.loadConfig(pathService.join(this.cliDir, '.env.local'));
      environment.loadConfig(pathService.join(this.cliDir, '.env'));

      // Load package information
      const packageJsonPath = pathService.join(this.cliDir, 'package.json');
      const packageJson = await fs.readFile(packageJsonPath, 'utf8');
      this.packageInfo = packageInfoSchema.parse(JSON.parse(packageJson));

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize CommandContext: ${getErrorMessage(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * Get package version
   */
  getVersion(): string {
    this.ensureInitialized();
    return this.packageInfo?.version ?? '0.0.0';
  }

  /**
   * Get CLI directory path
   */
  getCliDirectory(): string {
    this.ensureInitialized();
    return this.cliDir ?? process.cwd();
  }

  /**
   * Create integration manager for a project
   */
  async createIntegrationManager(projectPath = process.cwd()): Promise<IntegrationManager> {
    const environment = this.resolveEnvironmentService();
    const resolvedProjectPath = projectPath || environment.cwd();

    if (!this.integrationManager || this.integrationManager.projectPath !== resolvedProjectPath) {
      const manager: IntegrationManager = createIntegrationManager(resolvedProjectPath);
      this.integrationManager = manager;
    }
    return this.integrationManager;
  }

  /**
   * Read and parse VDK configuration file
   */
  async readVdkConfig(
    projectPath = process.cwd(),
    configPath = 'vdk.config.json'
  ): Promise<JsonObject | null> {
    const pathService = this.resolvePathService();
    const fileSystem = this.resolveFileSystem();
    const environment = this.resolveEnvironmentService();

    const resolvedProjectPath = projectPath || environment.cwd();
    const fullConfigPath = pathService.resolve(resolvedProjectPath, configPath);

    try {
      await fileSystem.access(fullConfigPath);
      const configContent = await fileSystem.readFile(fullConfigPath, 'utf8');
      const parsedConfig = JSON.parse(configContent);
      return isObject(parsedConfig) ? (parsedConfig as JsonObject) : null;
    } catch {
      // Return null for missing or invalid config files - this is expected behavior
      return null;
    }
  }

  /**
   * Write VDK configuration file
   */
  async writeVdkConfig(
    config: JsonObject,
    projectPath = process.cwd(),
    configPath = 'vdk.config.json'
  ): Promise<string> {
    const pathService = this.resolvePathService();
    const fileSystem = this.resolveFileSystem();
    const environment = this.resolveEnvironmentService();

    const resolvedProjectPath = projectPath || environment.cwd();
    const fullConfigPath = pathService.resolve(resolvedProjectPath, configPath);

    try {
      await fileSystem.writeFile(fullConfigPath, JSON.stringify(config, null, 2));
      return fullConfigPath;
    } catch (error) {
      throw new Error(
        `Failed to write VDK configuration to ${fullConfigPath}: ${getErrorMessage(error)}`,
        {
          cause: error,
        }
      );
    }
  }

  /**
   * Ensure rules directory exists
   */
  async ensureRulesDirectory(rulesPath: string): Promise<string> {
    const pathService = this.resolvePathService();
    const fileSystem = this.resolveFileSystem();

    const resolvedPath = pathService.resolve(rulesPath);
    try {
      await fileSystem.mkdir(resolvedPath, { recursive: true });
      return resolvedPath;
    } catch (error) {
      throw new Error(
        `Failed to create rules directory ${resolvedPath}: ${getErrorMessage(error)}`,
        {
          cause: error,
        }
      );
    }
  }

  /**
   * List files in directory with filtering
   */
  async listFiles(
    directoryPath: string,
    filter: ((filePath: string) => boolean) | null = null
  ): Promise<string[]> {
    const fileSystem = this.resolveFileSystem();

    try {
      const files = await fileSystem.readdir(directoryPath, { recursive: true });
      return filter ? files.filter(filter) : files;
    } catch {
      // Return empty array for missing directories - this is expected behavior
      return [];
    }
  }

  /**
   * Check if path exists
   */
  async pathExists(filePath: string): Promise<boolean> {
    const fileSystem = this.resolveFileSystem();

    try {
      await fileSystem.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve path relative to current working directory
   */
  resolvePath(relativePath: string): string {
    const pathService = this.resolvePathService();
    return pathService.resolve(relativePath);
  }

  /**
   * Get relative path for display purposes
   */
  getRelativePath(absolutePath: string, basePath = process.cwd()): string {
    const pathService = this.resolvePathService();
    const environment = this.resolveEnvironmentService();

    const resolvedBasePath = basePath || environment.cwd();
    return pathService.relative(resolvedBasePath, absolutePath);
  }

  /**
   * Ensure context is initialized
   */
  ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CommandContext must be initialized before use');
    }
  }

  /**
   * Clean up resources and clear caches
   * Useful for testing and preventing memory leaks
   */
  cleanup(): void {
    this.services.clear();
    this.integrationManager = null;
    this.initialized = false;
    this.packageInfo = null;
    this.cliDir = null;
  }

  /**
   * Create a new context instance with custom services (for testing)
   */
  static createWithServices(serviceContainer: ServiceContainer): CommandContext {
    return new CommandContext(serviceContainer);
  }

  /**
   * Get the service container (for advanced usage)
   */
  getServiceContainer(): ServiceContainer {
    return this.services;
  }

  /**
   * Register a custom service in the container
   */
  registerService(name: string, factory: ServiceFactory, singleton = false): void {
    this.services.register(name, factory, singleton);
  }

  /**
   * Check if a service is registered
   */
  hasService(name: string): boolean {
    return this.services.services.has(name);
  }
}

// Shared command context used across CLI commands.
export const commandContext = new CommandContext();

// Export ServiceContainer for advanced usage
export { ServiceContainer };
