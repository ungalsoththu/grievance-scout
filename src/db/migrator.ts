/**
 * Database Migration System
 * Safe upgrades with rollback capability
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { readdirSync, readFileSync } from 'fs';

export interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

export class DatabaseMigrator {
  private db: Database;
  private migrationsDir: string;

  constructor(dbPath: string, migrationsDir: string) {
    this.db = new Database(dbPath);
    this.migrationsDir = migrationsDir;
    this.ensureMigrationTable();
  }

  private ensureMigrationTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
        checksum TEXT NOT NULL,
        rollback_sql TEXT NOT NULL
      )
    `);
  }

  async getCurrentVersion(): Promise<string | null> {
    const row = this.db.query(
      "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"
    ).get() as { version: string } | null;
    return row?.version ?? null;
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const current = await this.getCurrentVersion();
    const all = this.loadMigrations();
    
    if (!current) return all;
    
    const currentIndex = all.findIndex(m => m.version === current);
    return currentIndex === -1 ? all : all.slice(currentIndex + 1);
  }

  private loadMigrations(): Migration[] {
    const files = readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    return files.map(file => {
      const content = readFileSync(join(this.migrationsDir, file), 'utf-8');
      const [up, down] = content.split('-- DOWN');
      
      return {
        version: file.replace('.sql', ''),
        name: this.extractName(content),
        up: up.trim(),
        down: down?.trim() || '',
        checksum: this.computeChecksum(up)
      };
    });
  }

  private extractName(content: string): string {
    const match = content.match(/-- Name: (.+)/);
    return match?.[1] || 'Unnamed migration';
  }

  private computeChecksum(sql: string): string {
    // Simple hash - in production use proper hash
    let hash = 0;
    for (let i = 0; i < sql.length; i++) {
      const char = sql.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  async migrate(targetVersion?: string): Promise<{ applied: string[]; current: string }> {
    const pending = await this.getPendingMigrations();
    const applied: string[] = [];

    for (const migration of pending) {
      if (targetVersion && migration.version > targetVersion) break;

      try {
        this.db.transaction(() => {
          this.db.exec(migration.up);
          this.db.run(
            `INSERT INTO schema_migrations (version, name, checksum, rollback_sql) 
             VALUES (?, ?, ?, ?)`,
            [migration.version, migration.name, migration.checksum, migration.down]
          );
        })();
        applied.push(migration.version);
      } catch (err) {
        throw new Error(`Migration ${migration.version} failed: ${err}`);
      }
    }

    const current = await this.getCurrentVersion();
    if (!current) throw new Error('Migration failed - no current version');
    
    return { applied, current };
  }

  async rollback(steps: number = 1): Promise<{ rolledBack: string[]; current: string | null }> {
    const migrations = this.db.query(
      `SELECT version, name, rollback_sql FROM schema_migrations 
       ORDER BY applied_at DESC LIMIT ?`
    ).all(steps) as Array<{ version: string; name: string; rollback_sql: string }>;

    const rolledBack: string[] = [];

    for (const m of migrations) {
      if (!m.rollback_sql) {
        console.warn(`Migration ${m.version} has no rollback SQL`);
        continue;
      }

      try {
        this.db.transaction(() => {
          this.db.exec(m.rollback_sql);
          this.db.run(
            'DELETE FROM schema_migrations WHERE version = ?',
            [m.version]
          );
        })();
        rolledBack.push(m.version);
      } catch (err) {
        throw new Error(`Rollback of ${m.version} failed: ${err}`);
      }
    }

    const current = await this.getCurrentVersion();
    return { rolledBack, current };
  }

  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    // Check all applied migrations still exist
    const applied = this.db.query(
      'SELECT version, checksum FROM schema_migrations'
    ).all() as Array<{ version: string; checksum: string }>;

    const available = this.loadMigrations();

    for (const a of applied) {
      const match = available.find(m => m.version === a.version);
      if (!match) {
        errors.push(`Migration ${a.version} was applied but file is missing`);
      } else if (match.checksum !== a.checksum) {
        errors.push(`Migration ${a.version} checksum mismatch - file was modified`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  close(): void {
    this.db.close();
  }
}
