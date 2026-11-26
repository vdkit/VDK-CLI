/**
 * VDK Project Scanner Module
 * --------------------------
 * Typed entry point for the scanner runtime.
 */

import { runScanner as rawRunScanner } from './engine.js';

export type ScannerOptions = {
  categories?: string[];
  components?: boolean;
  deep: boolean;
  existingConfig?: Record<string, unknown>;
  force?: boolean;
  generateAgents?: boolean;
  ide?: string;
  ideIntegration: boolean;
  ignorePattern: string[];
  incremental?: boolean;
  interactive?: boolean;
  mode?: string;
  outputPath: string;
  overwrite: boolean;
  preset?: string;
  projectPath: string;
  targetIde?: string;
  template: string;
  useGitignore: boolean;
  verbose: boolean;
  watch: boolean;
};

export type GeneratedScannerFile =
  | string
  | {
      path?: string;
    };

export type ScannerComponentPlatformResult = {
  componentCount: number;
  errors: string[];
  success: boolean;
};

export type ScannerComponentResult = {
  platforms: Record<string, ScannerComponentPlatformResult>;
  totalComponents: number;
};

export type WatchableIdeIntegration = {
  getPrimaryIDE?: () =>
    | {
        name?: string;
      }
    | null
    | undefined;
  healthCheck?: () => void;
  shutdown?: () => Promise<void> | void;
};

export type ScannerRunResult = {
  componentResults?: ScannerComponentResult;
  componentsGenerated?: number;
  detectedPrimaryIDE: string | null;
  generatedFiles: GeneratedScannerFile[];
  ideIntegration: WatchableIdeIntegration | null;
  initializedIDEs: string[];
  projectName: string;
};

const runScannerInternal: (options: ScannerOptions) => Promise<ScannerRunResult> = rawRunScanner;

export async function runScanner(options: ScannerOptions): Promise<ScannerRunResult> {
  return runScannerInternal(options);
}
