/**
 * Database Adapter Factory
 * Creates appropriate adapter based on configuration
 */

import type { DatabaseAdapter } from './interface';
import { BunSQLiteAdapter, type SQLiteConfig } from './sqlite-bun';

export interface DatabaseConfig {
  activeAdapter: 'sqlite' | 'turso' | 'postgres';
  sqlite?: SQLiteConfig;
  turso?: {
    url: string;
    authToken: string;
  };
  postgres?: {
    connectionString: string;
    poolSize?: number;
  };
}

export async function createAdapter(config: DatabaseConfig): Promise<DatabaseAdapter> {
  switch (config.activeAdapter) {
    case 'sqlite':
      if (!config.sqlite) {
        throw new Error('SQLite config required when activeAdapter is sqlite');
      }
      const adapter = new BunSQLiteAdapter(config.sqlite);
      await adapter.connect();
      await adapter.runMigrations();
      return adapter;

    case 'turso':
      throw new Error('Turso adapter not yet implemented');

    case 'postgres':
      throw new Error('Postgres adapter not yet implemented');

    default:
      throw new Error(`Unknown adapter: ${config.activeAdapter}`);
  }
}

export async function getDefaultAdapter(): Promise<DatabaseAdapter> {
  const dbPath = process.env.AUDIT_DB_PATH || '/home/workspace/Data/grievance-scout/audit.db';
  
  const config: DatabaseConfig = {
    activeAdapter: 'sqlite',
    sqlite: {
      path: dbPath,
      create: true
    }
  };

  return createAdapter(config);
}
