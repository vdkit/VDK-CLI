/**
 * Hub Status Utilities
 * --------------------
 * Shared utilities for checking and displaying Hub status across commands.
 */

import { colors } from '../utils/cli-styles.js';
import type {
  HubConnectivityResult,
  HubOperations,
  HubSessionSnapshot,
  HubStatusSnapshot,
} from '../commands/base/BaseCommand.js';

type HubStatusOperations = Pick<HubOperations, 'getSession' | 'getStatus' | 'testConnection'>;
type HubStatusTableState = 'error' | 'success' | 'warning';
type HubStatusTableRow = [string, HubStatusTableState, string];

export type HubStatusDetails = {
  available: boolean;
  connected: boolean;
  connectivity?: HubConnectivityResult;
  error?: string;
  session?: HubSessionSnapshot | null;
  status?: HubStatusSnapshot;
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

export async function getHubStatus(
  hubOps: HubStatusOperations | null | undefined
): Promise<HubStatusDetails> {
  if (
    hubOps === null ||
    hubOps === undefined ||
    typeof hubOps.getStatus !== 'function' ||
    typeof hubOps.testConnection !== 'function' ||
    typeof hubOps.getSession !== 'function'
  ) {
    return {
      available: false,
      connected: false,
      error: 'Hub operations not available',
    };
  }

  try {
    const status = hubOps.getStatus();
    const connectivity = await hubOps.testConnection();

    return {
      available: true,
      connected: connectivity.success,
      status,
      connectivity,
      session: hubOps.getSession(),
    };
  } catch (error) {
    return {
      available: true,
      connected: false,
      error: getErrorMessage(error),
    };
  }
}

export function formatHubStatusForTable(hubStatus: HubStatusDetails): HubStatusTableRow {
  if (!hubStatus.available) {
    return ['VDK Hub Integration', 'error', 'Cannot connect to VDK Hub'];
  }

  if (hubStatus.connected && hubStatus.connectivity) {
    const latency = hubStatus.connectivity.latency ?? 'unknown';
    const version = hubStatus.connectivity.version ?? 'unknown';
    return ['VDK Hub Integration', 'success', `Connected (${latency}ms)\nVersion: ${version}`];
  }

  if (hubStatus.error) {
    return ['VDK Hub Integration', 'error', hubStatus.error];
  }

  return ['VDK Hub Integration', 'warning', 'Hub available but connection failed'];
}

export function displayDetailedHubStatus(hubStatus: HubStatusDetails, verbose = false): void {
  if (!hubStatus.available) {
    writeStdout(`Hub Integration: ${colors.error('✗ Not Available')}`);
    writeStdout(`Error: ${hubStatus.error ?? 'Unknown error'}`);
    return;
  }

  const hubStatusData = hubStatus.status;
  const connectivity = hubStatus.connectivity;
  const session = hubStatus.session;

  if (hubStatusData) {
    writeStdout(
      `Hub Integration: ${
        hubStatusData.initialized
          ? colors.success('✓ Initialized')
          : colors.error('✗ Not Initialized')
      }`
    );
    writeStdout(
      `Hub Connected: ${
        hubStatusData.hubConnected ? colors.success('✓ Connected') : colors.error('✗ Disconnected')
      }`
    );
    writeStdout(
      `Telemetry: ${
        hubStatusData.telemetryEnabled ? colors.success('✓ Enabled') : colors.warning('✗ Disabled')
      }`
    );
  }

  if (session) {
    writeStdout(`Session ID: ${session.sessionId}`);
    writeStdout(`Uptime: ${Math.round(session.uptime / 1000)}s`);
  }

  if (connectivity?.success) {
    writeStdout(
      `Connection: ${colors.success('✓ Connected')} (${connectivity.latency ?? 'unknown'}ms)`
    );
    writeStdout(`Hub Version: ${connectivity.version ?? 'unknown'}`);

    if (verbose && connectivity.capabilities) {
      writeStdout(`\n${colors.primary('Detailed Status:')}`);
      writeStdout('\nHub Capabilities:');

      for (const [key, value] of Object.entries(connectivity.capabilities)) {
        const capabilityStatus = value ? colors.success('✓') : colors.error('✗');
        writeStdout(`  ${capabilityStatus} ${key}`);
      }

      if (connectivity.limits) {
        writeStdout('\nRate Limits:');
        writeStdout(`  Daily Requests: ${connectivity.limits.dailyRequests ?? 'Unlimited'}`);
        writeStdout(`  Concurrent: ${connectivity.limits.concurrent ?? 'Unlimited'}`);
      }

      if (connectivity.features) {
        writeStdout('\nEnabled Features:');
        for (const feature of connectivity.features) {
          writeStdout(`  • ${feature}`);
        }
      }
    }
    return;
  }

  writeStdout(
    `Connection: ${colors.error('✗ Failed')} (${connectivity?.error ?? hubStatus.error ?? 'Unknown error'})`
  );
}

export function displayTroubleshootingTips(): void {
  writeStdout(`\n${colors.primary('Troubleshooting Tips:')}`);
  writeStdout('• Check your internet connection');
  writeStdout('• Verify VDK_HUB_URL environment variable');
  writeStdout('• Try running: vdk init --force');
  writeStdout('• Check firewall and proxy settings');
  writeStdout('• Visit https://vdk.dev/docs/troubleshooting for more help');
}
