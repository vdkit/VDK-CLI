import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HubGenerateCommand } from '../src/commands/hub/HubGenerateCommand.js';

describe('HubGenerateCommand Package Response Validation', () => {
  let command;

  beforeEach(() => {
    command = new HubGenerateCommand();
  });

  it('should normalize valid package result values', () => {
    const validated = command.validatePackageResult({
      packageId: 'pkg-123',
      downloadUrl: 'https://vdk.tools/download/pkg-123',
      packageType: 'zip',
      blueprintCount: '6',
      fileSize: '4096',
      expiresAt: '2026-12-31T23:59:59.000Z',
    });

    expect(validated.packageId).toBe('pkg-123');
    expect(validated.blueprintCount).toBe(6);
    expect(validated.fileSize).toBe(4096);
  });

  it('should reject package result without required fields', () => {
    expect(() =>
      command.validatePackageResult({
        packageType: 'zip',
        blueprintCount: 2,
        fileSize: 100,
        expiresAt: '2026-12-31T23:59:59.000Z',
      })
    ).toThrow(/missing packageId/i);
  });

  it('should reject invalid blueprintCount values', () => {
    expect(() =>
      command.validatePackageResult({
        packageId: 'pkg-123',
        downloadUrl: 'https://vdk.tools/download/pkg-123',
        packageType: 'zip',
        blueprintCount: 'not-a-number',
        fileSize: 100,
        expiresAt: '2026-12-31T23:59:59.000Z',
      })
    ).toThrow(/blueprintCount must be a valid number/i);
  });

  it('should fail generation when Hub returns malformed package payload', async () => {
    const spinner = {
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    command.createSpinner = vi.fn().mockReturnValue(spinner);

    const hubOps = {
      generatePackage: vi.fn().mockResolvedValue({
        packageType: 'zip',
        blueprintCount: 2,
        fileSize: 1024,
        expiresAt: '2026-12-31T23:59:59.000Z',
      }),
    };

    await expect(command.generatePackage(hubOps, {}, {})).rejects.toThrow(
      /invalid package response/i
    );
    expect(spinner.fail).toHaveBeenCalledWith('Package generation failed');
  });

  it('should forward --platform as the Hub target IDE', () => {
    expect(
      command.buildGenerateOptions({
        format: 'bash',
        platform: 'cursor',
        ai: 'claude-code',
      })
    ).toMatchObject({
      outputFormat: 'bash',
      targetIde: 'cursor',
      integrations: [{ type: 'claude-code' }],
    });
  });
});
