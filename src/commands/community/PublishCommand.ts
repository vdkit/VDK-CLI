/**
 * PublishCommand
 * -----------------------
 * Publish your VDK rules to the community via Hub or GitHub PR.
 */

import type { Command } from 'commander';

import { colors } from '../../utils/cli-styles.js';
import { BaseCommand } from '../base/BaseCommand.js';
import { commandContext } from '../shared/CommandContext.js';

type PublishCommandOptions = {
  args?: string[];
  github?: boolean;
  name?: string;
  preview?: boolean;
  private?: boolean;
  verbose?: boolean;
};

type PublishPreview = {
  recommendations: string[];
  summary: string;
  validation: {
    qualityScore?: number;
    warnings: string[];
  };
};

type PublishResult = {
  platform?: string;
  prUrl?: string;
  shareUrl?: string;
  success: boolean;
};

type PublishManager = {
  previewPublication: (ruleFile: string) => Promise<PublishPreview>;
  publish: (
    ruleFile: string,
    options: {
      github: boolean;
      name?: string;
      private: boolean;
      verbose: boolean;
    }
  ) => Promise<PublishResult>;
};

type CliColors = {
  muted: (message: string) => string;
  success: (message: string) => string;
  warning: (message: string) => string;
};

const cliColors: CliColors = colors;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class PublishCommand extends BaseCommand {
  constructor() {
    super('publish', 'Publish your VDK rules to the community');
  }

  /**
   * Configure command-specific options
   */
  configureOptions(command: Command): Command {
    return command
      .argument('[rule-file]', 'Rule file to publish (.mdc, .md, .json, .xml)')
      .option(
        '--github',
        'Publish via GitHub PR instead of VDK Hub (no registration required)',
        false
      )
      .option('--private', 'Create private share link (Hub only)', false)
      .option('--name <name>', 'Custom name for the published rule')
      .option('--preview', 'Preview what would be published without actually publishing', false)
      .option('-v, --verbose', 'Enable verbose output', false);
  }

  /**
   * Execute the publish command
   */
  async execute(options: PublishCommandOptions): Promise<PublishPreview | PublishResult | void> {
    await commandContext.initialize();
    this.showHeader();

    const ruleFile = options.args?.[0];
    if (!ruleFile) {
      this.exitWithError('Rule file argument is required. Use --help for usage information');
    }

    try {
      const { PublishManager: PublishManagerModule } =
        await import('../../publishing/PublishManager.js');
      const publisher: PublishManager = new PublishManagerModule(process.cwd());

      if (options.preview) {
        return await this.showPublishPreview(publisher, ruleFile);
      }

      return await this.executePublish(publisher, ruleFile, options);
    } catch (error) {
      const publishError = error instanceof Error ? error : new Error(String(error));
      this.exitWithError(`Publishing failed: ${publishError.message}`, publishError);
    }
  }

  /**
   * Show publish preview
   */
  async showPublishPreview(publisher: PublishManager, ruleFile: string): Promise<PublishPreview> {
    const spinner = this.createSpinner('Generating publication preview...');
    spinner.start();

    const preview = await publisher.previewPublication(ruleFile);
    spinner.succeed('Preview generated');

    console.log('');
    console.log(this.colorCyan('📋 Publication Preview:'));
    console.log(cliColors.muted(`   ${preview.summary}`));
    console.log('');

    if (preview.validation.qualityScore) {
      console.log(this.colorCyan(`📊 Quality Score: ${preview.validation.qualityScore}/10`));
    }

    if (preview.recommendations.length > 0) {
      console.log('');
      console.log(cliColors.warning('💡 Recommendations:'));
      preview.recommendations.forEach(rec => {
        console.log(cliColors.muted(`   • ${rec}`));
      });
    }

    if (preview.validation.warnings.length > 0) {
      console.log('');
      console.log(cliColors.warning('⚠️  Warnings:'));
      preview.validation.warnings.forEach(warning => {
        console.log(cliColors.warning(`   • ${warning}`));
      });
    }

    return preview;
  }

  /**
   * Execute actual publishing
   */
  async executePublish(
    publisher: PublishManager,
    ruleFile: string,
    options: PublishCommandOptions
  ): Promise<PublishResult> {
    const result = await publisher.publish(ruleFile, {
      github: options.github === true,
      private: options.private === true,
      name: options.name,
      verbose: options.verbose === true,
    });

    if (result.success) {
      console.log('');
      console.log(cliColors.success('🎉 Rule published successfully!'));

      if (result.platform === 'hub') {
        this.showHubPublishResult(result);
      } else if (result.platform === 'github') {
        this.showGitHubPublishResult(result);
      }

      this.trackSuccess({
        platform: result.platform,
        ruleFile: ruleFile,
        private: options.private === true,
      });
    }

    return result;
  }

  /**
   * Show Hub publication result
   */
  showHubPublishResult(result: PublishResult): void {
    console.log('');
    console.log(this.colorCyan('🔗 Share your rule:'));
    console.log(cliColors.muted(`   ${result.shareUrl ?? ''}`));
    console.log('');
    console.log(this.colorCyan('📧 Check your email to activate permanent sharing'));
    console.log(this.colorCyan('💡 Community can use with:'));
    console.log(cliColors.muted('   vdk sync'));
  }

  /**
   * Show GitHub publication result
   */
  showGitHubPublishResult(result: PublishResult): void {
    console.log('');
    console.log(this.colorCyan('📝 GitHub PR created:'));
    console.log(cliColors.muted(`   ${result.prUrl ?? ''}`));
    console.log('');
    console.log(this.colorCyan('⏳ After community review and merge:'));
    console.log(cliColors.muted('   vdk sync'));
  }
}
