#!/usr/bin/env bun
/**
 * Zo Working Copy Manager
 * Installs/updates grievance-scout from GitHub with safe migrations
 * 
 * Usage:
 *   bun run scripts/zo-install.ts [command] [options]
 * 
 * Commands:
 *   install [--tag v1.0.0] [--path /home/workspace/Data/grievance-scout]
 *   update [--backup] [--dry-run]
 *   rollback [--steps 1]
 *   status
 *   validate
 */

import { Command } from 'commander';
import { DatabaseMigrator } from '../src/db/migrator';
import { existsSync, mkdirSync, cpSync, rmSync, renameSync, statSync } from 'fs';
import { join } from 'path';

const REPO_URL = 'https://github.com/ungalsoththu/grievance-scout.git';
const DEFAULT_WORK_DIR = '/home/workspace/Data/grievance-scout';
const BACKUP_RETENTION_DAYS = 7;

interface InstallOptions {
  tag?: string;
  path: string;
  force?: boolean;
}

interface UpdateOptions {
  backup: boolean;
  dryRun: boolean;
  autoMigrate: boolean;
}

function getWorkDir(customPath?: string): string {
  return customPath || process.env.GRIEVANCE_SCOUT_PATH || DEFAULT_WORK_DIR;
}

function getDataDir(workDir: string): string {
  return join(workDir, 'data');
}

function getBackupDir(workDir: string): string {
  return join(workDir, '.backups');
}

function ensureDirs(workDir: string): void {
  mkdirSync(workDir, { recursive: true });
  mkdirSync(getDataDir(workDir), { recursive: true });
  mkdirSync(getBackupDir(workDir), { recursive: true });
}

async function getLatestTag(): Promise<string> {
  const response = await fetch(
    'https://api.github.com/repos/ungalsoththu/grievance-scout/releases/latest'
  );
  if (!response.ok) throw new Error('Failed to fetch latest release');
  const release = await response.json() as { tag_name: string };
  return release.tag_name;
}

async function downloadRelease(tag: string, dest: string): Promise<void> {
  const url = tag === 'main' 
    ? `${REPO_URL.replace('.git', '')}/archive/refs/heads/main.tar.gz`
    : `${REPO_URL.replace('.git', '')}/archive/refs/tags/${tag}.tar.gz`;
  
  console.log(`Downloading ${tag}...`);
  
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  
  const tarPath = join(dest, 'source.tar.gz');
  const buffer = await response.arrayBuffer();
  await Bun.write(tarPath, buffer);
  
  // Extract
  const extractCmd = `tar -xzf "${tarPath}" -C "${dest}" --strip-components=1`;
  const proc = Bun.spawn(['bash', '-c', extractCmd]);
  await proc.exited;
  
  // Cleanup
  rmSync(tarPath);
  
  console.log(`✓ Downloaded to ${dest}`);
}

async function createBackup(workDir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(getBackupDir(workDir), timestamp);
  const dataDir = getDataDir(workDir);
  
  if (!existsSync(dataDir)) {
    throw new Error('No data directory to backup');
  }
  
  console.log(`Creating backup: ${backupDir}`);
  cpSync(dataDir, backupDir, { recursive: true });
  
  // Also backup version info
  const versionFile = join(workDir, 'version.json');
  if (existsSync(versionFile)) {
    cpSync(versionFile, join(backupDir, 'version.json'));
  }
  
  // Cleanup old backups
  cleanupOldBackups(workDir);
  
  return backupDir;
}

function cleanupOldBackups(workDir: string): void {
  const backupDir = getBackupDir(workDir);
  if (!existsSync(backupDir)) return;
  
  const entries = Array.from(Bun.file(backupDir).stream());
  const cutoff = Date.now() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  
  for (const entry of entries) {
    const path = join(backupDir, entry.toString());
    const stats = statSync(path);
    if (stats.mtimeMs < cutoff) {
      console.log(`Removing old backup: ${entry}`);
      rmSync(path, { recursive: true });
    }
  }
}

async function runMigrations(workDir: string): Promise<{ applied: string[]; current: string }> {
  const dataDir = getDataDir(workDir);
  const dbPath = join(dataDir, 'audit.db');
  const migrationsDir = join(workDir, 'migrations');
  
  if (!existsSync(dbPath)) {
    console.log('No existing database, migrations not needed');
    return { applied: [], current: 'none' };
  }
  
  const migrator = new DatabaseMigrator(dbPath, migrationsDir);
  
  try {
    // Validate first
    const validation = await migrator.validate();
    if (!validation.valid) {
      throw new Error(`Validation failed:\n${validation.errors.join('\n')}`);
    }
    
    // Run migrations
    const result = await migrator.migrate();
    migrator.close();
    
    return result;
  } catch (err) {
    migrator.close();
    throw err;
  }
}

async function install(options: InstallOptions): Promise<void> {
  const workDir = options.path;
  
  if (existsSync(workDir) && !options.force) {
    console.error(`Directory exists: ${workDir}`);
    console.error('Use --force to overwrite or run update instead');
    process.exit(1);
  }
  
  const tag = options.tag || await getLatestTag();
  console.log(`Installing grievance-scout ${tag} to ${workDir}`);
  
  // Create temp directory
  const tempDir = join(workDir, '.install-temp');
  mkdirSync(tempDir, { recursive: true });
  
  try {
    // Download
    await downloadRelease(tag, tempDir);
    
    // If force and exists, backup then replace
    if (existsSync(workDir) && options.force) {
      const backup = join(workDir, '.pre-install-backup');
      if (existsSync(backup)) rmSync(backup, { recursive: true });
      renameSync(workDir, backup);
      mkdirSync(workDir, { recursive: true });
    }
    
    // Move from temp to final
    const entries = ['src', 'scripts', 'config', 'migrations', 'tests', 'version.json', 'README.md'];
    for (const entry of entries) {
      const src = join(tempDir, entry);
      const dest = join(workDir, entry);
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true });
      }
    }
    
    // Ensure data dirs
    ensureDirs(workDir);
    
    // Run migrations
    const migrationResult = await runMigrations(workDir);
    if (migrationResult.applied.length > 0) {
      console.log(`Applied migrations: ${migrationResult.applied.join(', ')}`);
    }
    
    // Cleanup temp
    rmSync(tempDir, { recursive: true });
    
    console.log('\n✓ Installation complete');
    console.log(`Work directory: ${workDir}`);
    console.log(`Database: ${getDataDir(workDir)}/audit.db`);
    console.log(`Version: ${tag}`);
    
  } catch (err) {
    // Cleanup on failure
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    throw err;
  }
}

async function update(options: UpdateOptions): Promise<void> {
  const workDir = getWorkDir();
  
  if (!existsSync(workDir)) {
    console.error('No existing installation found. Run install first.');
    process.exit(1);
  }
  
  const currentVersion = await getCurrentVersion(workDir);
  const latestTag = await getLatestTag();
  
  console.log(`Current: ${currentVersion}`);
  console.log(`Latest: ${latestTag}`);
  
  if (currentVersion === latestTag) {
    console.log('Already up to date');
    return;
  }
  
  if (options.dryRun) {
    console.log('Dry run - would update to:', latestTag);
    return;
  }
  
  // Backup
  let backupPath: string | null = null;
  if (options.backup) {
    backupPath = await createBackup(workDir);
    console.log(`Backup created: ${backupPath}`);
  }
  
  try {
    // Download to temp
    const tempDir = join(workDir, '.update-temp');
    mkdirSync(tempDir, { recursive: true });
    
    await downloadRelease(latestTag, tempDir);
    
    // Preserve data and config
    const dataDir = getDataDir(workDir);
    const configDir = join(workDir, 'config');
    
    // Copy new files
    const entries = ['src', 'scripts', 'migrations', 'tests', 'version.json'];
    for (const entry of entries) {
      const src = join(tempDir, entry);
      const dest = join(workDir, entry);
      if (existsSync(dest)) rmSync(dest, { recursive: true });
      if (existsSync(src)) cpSync(src, dest, { recursive: true });
    }
    
    // Cleanup temp
    rmSync(tempDir, { recursive: true });
    
    // Run migrations
    if (options.autoMigrate) {
      const result = await runMigrations(workDir);
      if (result.applied.length > 0) {
        console.log(`✓ Applied migrations: ${result.applied.join(', ')}`);
      }
    }
    
    // Update version file
    const versionPath = join(workDir, 'version.json');
    if (existsSync(versionPath)) {
      const version = JSON.parse(await Bun.file(versionPath).text());
      version.installedAt = new Date().toISOString();
      version.installedFrom = latestTag;
      await Bun.write(versionPath, JSON.stringify(version, null, 2));
    }
    
    console.log(`\n✓ Updated to ${latestTag}`);
    
  } catch (err) {
    console.error('Update failed:', err);
    
    if (backupPath && existsSync(backupPath)) {
      console.log(`\nRestore available from: ${backupPath}`);
      console.log(`Run: cp -r "${backupPath}/." "${getDataDir(workDir)}/"`);
    }
    
    process.exit(1);
  }
}

async function getCurrentVersion(workDir: string): Promise<string> {
  const versionPath = join(workDir, 'version.json');
  if (!existsSync(versionPath)) return 'unknown';
  
  const version = JSON.parse(await Bun.file(versionPath).text());
  return version.installedFrom || version.version;
}

async function status(): Promise<void> {
  const workDir = getWorkDir();
  
  console.log('=== Zo Working Copy Status ===\n');
  
  if (!existsSync(workDir)) {
    console.log('Status: Not installed');
    console.log(`Run: bun run scripts/zo-install.ts install --path ${workDir}`);
    return;
  }
  
  const currentVersion = await getCurrentVersion(workDir);
  console.log(`Work directory: ${workDir}`);
  console.log(`Current version: ${currentVersion}`);
  
  // Check database
  const dbPath = join(getDataDir(workDir), 'audit.db');
  if (existsSync(dbPath)) {
    const size = statSync(dbPath).size;
    console.log(`Database: ${dbPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log('Database: Not initialized');
  }
  
  // Check backups
  const backupDir = getBackupDir(workDir);
  if (existsSync(backupDir)) {
    const backups = Array.from(Bun.file(backupDir).stream());
    console.log(`Backups: ${backups.length} available`);
  }
  
  // Migration status
  if (existsSync(dbPath)) {
    const migrator = new DatabaseMigrator(dbPath, join(workDir, 'migrations'));
    const current = await migrator.getCurrentVersion();
    const pending = await migrator.getPendingMigrations();
    console.log(`Schema version: ${current || 'none'}`);
    console.log(`Pending migrations: ${pending.length}`);
    migrator.close();
  }
}

async function rollback(steps: number): Promise<void> {
  const workDir = getWorkDir();
  const dbPath = join(getDataDir(workDir), 'audit.db');
  
  if (!existsSync(dbPath)) {
    console.error('No database found');
    process.exit(1);
  }
  
  const migrator = new DatabaseMigrator(dbPath, join(workDir, 'migrations'));
  
  try {
    console.log(`Rolling back ${steps} migration(s)...`);
    const result = await migrator.rollback(steps);
    console.log(`Rolled back: ${result.rolledBack.join(', ')}`);
    console.log(`Current version: ${result.current || 'none'}`);
  } finally {
    migrator.close();
  }
}

async function validate(): Promise<void> {
  const workDir = getWorkDir();
  const dbPath = join(getDataDir(workDir), 'audit.db');
  
  if (!existsSync(dbPath)) {
    console.log('No database to validate');
    return;
  }
  
  const migrator = new DatabaseMigrator(dbPath, join(workDir, 'migrations'));
  
  try {
    const result = await migrator.validate();
    
    if (result.valid) {
      console.log('✓ All validations passed');
    } else {
      console.error('✗ Validation failed:');
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
  } finally {
    migrator.close();
  }
}

// CLI Setup
const program = new Command();

program
  .name('zo-install')
  .description('Manage Zo working copy of grievance-scout');

program
  .command('install')
  .description('Install from GitHub release')
  .option('-t, --tag <tag>', 'Specific version tag', 'latest')
  .option('-p, --path <path>', 'Installation directory')
  .option('-f, --force', 'Overwrite existing installation')
  .action(async (opts) => {
    const tag = opts.tag === 'latest' ? 'main' : opts.tag;
    await install({
      tag,
      path: getWorkDir(opts.path),
      force: opts.force
    });
  });

program
  .command('update')
  .description('Update to latest release')
  .option('-b, --backup', 'Create backup before update', true)
  .option('-n, --no-backup', 'Skip backup')
  .option('--dry-run', 'Show what would be updated')
  .option('--no-auto-migrate', 'Skip automatic migrations')
  .action(async (opts) => {
    await update({
      backup: opts.backup,
      dryRun: opts.dryRun,
      autoMigrate: opts.autoMigrate
    });
  });

program
  .command('status')
  .description('Show current installation status')
  .action(status);

program
  .command('rollback')
  .description('Rollback database migrations')
  .option('-s, --steps <n>', 'Number of migrations to rollback', '1')
  .action(async (opts) => {
    await rollback(parseInt(opts.steps));
  });

program
  .command('validate')
  .description('Validate installation integrity')
  .action(validate);

program.parse();
