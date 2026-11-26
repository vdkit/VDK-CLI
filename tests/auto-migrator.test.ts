/**
 * AutoMigrator tests aligned with current migration conventions.
 *
 * Primary staging directory: .vdk/migrate
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoMigrator } from '../src/migration/AutoMigrator.js';

describe('AutoMigrator (current behavior)', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vdk-auto-migrator-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    vi.restoreAllMocks();
  });

  it('uses .vdk/migrate as primary import path', () => {
    const migrator = new AutoMigrator(tempDir);

    expect(migrator.projectPath).toBe(tempDir);
    expect(migrator.importPath).toBe(path.join(tempDir, '.vdk', 'migrate'));
  });

  it('detects cursor rules from .vdk/migrate', async () => {
    const migrateDir = path.join(tempDir, '.vdk', 'migrate');
    await fs.mkdir(migrateDir, { recursive: true });
    await fs.writeFile(path.join(migrateDir, 'project.mdc'), 'Use TypeScript\nUse linting\n');
    await fs.writeFile(path.join(migrateDir, 'react.mdc'), '# React rules\nUse hooks\n');

    const migrator = new AutoMigrator(tempDir);
    const detected = await migrator.detectImportedRules();

    expect(detected.length).toBeGreaterThan(0);
    expect(detected.some(rule => rule.type === 'cursor')).toBe(true);
    expect(detected.some(rule => rule.originalFile === 'project.mdc')).toBe(true);
  });

  it('only scans the canonical .vdk/migrate directory', async () => {
    const migrateDir = path.join(tempDir, '.vdk', 'migrate');
    await fs.mkdir(migrateDir, { recursive: true });

    await fs.writeFile(path.join(migrateDir, 'project.mdc'), 'Cursor content\n');

    const migrator = new AutoMigrator(tempDir);
    const detected = await migrator.detectImportedRules();

    expect(detected).toHaveLength(1);
    expect(detected[0].type).toBe('cursor');
  });

  it('returns no_rules_found when staging directories are empty/missing', async () => {
    const migrator = new AutoMigrator(tempDir);
    const result = await migrator.migrate({ preview: false });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_rules_found');
  });

  it('cleans the canonical .vdk/migrate directory', async () => {
    const migrateDir = path.join(tempDir, '.vdk', 'migrate');
    await fs.mkdir(migrateDir, { recursive: true });
    await fs.writeFile(path.join(migrateDir, 'rule.md'), '# rule\n');

    const migrator = new AutoMigrator(tempDir);
    await migrator.cleanImportDirectory();

    const migrateExists = await fs
      .access(migrateDir)
      .then(() => true)
      .catch(() => false);

    expect(migrateExists).toBe(false);
  });

  it('shows migrate-first instructions', () => {
    const migrator = new AutoMigrator(tempDir);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    migrator.showImportInstructions();

    const text = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(text).toContain('mkdir -p .vdk/migrate');
  });

  it('generates correct preview summary text', () => {
    const migrator = new AutoMigrator(tempDir);
    const summary = migrator.generatePreviewSummary({
      rules: [{}, {}],
      adaptations: ['a', 'b', 'c'],
      platforms: ['claude-code'],
    });

    expect(summary).toBe('Will migrate 2 rule files with 3 adaptations for 1 platform');
  });
});
