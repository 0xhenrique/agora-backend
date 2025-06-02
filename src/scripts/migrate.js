import db from '../database/db.js';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class MigrationRunner {
  constructor() {
    this.migrationsDir = join(__dirname, '../database/migrations');
  }

  async ensureMigrationsTable() {
    await db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getAppliedMigrations() {
    const result = await db.all('SELECT filename FROM migrations ORDER BY filename');
    return result.map(row => row.filename);
  }

  async getMigrationFiles() {
    const files = readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Ensure proper order
    return files;
  }

  async checkColumnExists(tableName, columnName) {
    const tableInfo = await db.all(`PRAGMA table_info(${tableName})`);
    return tableInfo.some(col => col.name === columnName);
  }

  async applyMigration(filename) {
    console.log(`Applying migration: ${filename}`);
    
    const migrationPath = join(this.migrationsDir, filename);
    const migrationContent = readFileSync(migrationPath, 'utf8');
    
    // Handle special case for moderation migration (002)
    if (filename.includes('002_add_moderation')) {
      await this.applyModerationMigration(migrationContent);
    } else {
      await this.executeStandardMigration(migrationContent);
    }
    
    // Record migration as applied
    await db.run('INSERT INTO migrations (filename) VALUES (?)', [filename]);
    console.log(`✓ Migration ${filename} applied successfully`);
  }

  async applyModerationMigration(content) {
    // First, check and add columns to users table if needed
    const roleExists = await this.checkColumnExists('users', 'role');
    const bannedExists = await this.checkColumnExists('users', 'is_banned');
    
    if (!roleExists) {
      console.log('  Adding role column to users table...');
      await db.run(`
        ALTER TABLE users 
        ADD COLUMN role TEXT DEFAULT 'user' 
        CHECK (role IN ('user', 'moderator', 'admin'))
      `);
    } else {
      console.log('  Role column already exists');
    }
    
    if (!bannedExists) {
      console.log('  Adding is_banned column to users table...');
      await db.run(`
        ALTER TABLE users 
        ADD COLUMN is_banned BOOLEAN DEFAULT FALSE
      `);
    } else {
      console.log('  is_banned column already exists');
    }
    
    // Execute the rest of the migration (tables and indexes)
    await this.executeStandardMigration(content);
  }

  async executeStandardMigration(content) {
    // Split by semicolon and execute each statement
    const statements = content
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => 
        stmt.length > 0 && 
        !stmt.startsWith('--') && 
        !stmt.includes('ALTER TABLE users ADD COLUMN') // Skip these, handled separately
      );
    
    for (const statement of statements) {
      try {
        if (statement.trim()) {
          await db.run(statement);
        }
      } catch (error) {
        // Only ignore specific "already exists" errors
        if (error.message.includes('already exists') || 
            error.message.includes('duplicate column name')) {
          console.log(`    Skipping (already exists): ${statement.substring(0, 50)}...`);
        } else {
          throw error;
        }
      }
    }
  }

  async run() {
    try {
      console.log('🚀 Starting database migrations...\n');
      
      // Connect to database
      await db.connect();
      
      // Ensure migrations table exists
      await this.ensureMigrationsTable();
      
      // Get applied and available migrations
      const appliedMigrations = await this.getAppliedMigrations();
      const availableMigrations = await this.getMigrationFiles();
      
      console.log(`Applied migrations: ${appliedMigrations.length}`);
      console.log(`Available migrations: ${availableMigrations.length}\n`);
      
      // Find pending migrations
      const pendingMigrations = availableMigrations.filter(
        migration => !appliedMigrations.includes(migration)
      );
      
      if (pendingMigrations.length === 0) {
        console.log('✅ No pending migrations. Database is up to date!');
        return;
      }
      
      console.log(`📋 Pending migrations: ${pendingMigrations.length}`);
      pendingMigrations.forEach(migration => console.log(`  - ${migration}`));
      console.log();
      
      // Apply pending migrations
      for (const migration of pendingMigrations) {
        await this.applyMigration(migration);
      }
      
      console.log('\n✅ All migrations applied successfully!');
      
      // Show final status
      await this.showStatus();
      
    } catch (error) {
      console.error('\n❌ Migration failed:', error);
      process.exit(1);
    } finally {
      await db.close();
    }
  }

  async showStatus() {
    console.log('\n📊 Database Status:');
    
    // Show applied migrations
    const migrations = await db.all(`
      SELECT filename, applied_at 
      FROM migrations 
      ORDER BY applied_at DESC 
      LIMIT 5
    `);
    
    console.log('Recent migrations:');
    migrations.forEach(m => {
      const date = new Date(m.applied_at).toLocaleString();
      console.log(`  ✓ ${m.filename} (${date})`);
    });
    
    // Show table counts
    try {
      const userCount = await db.get('SELECT COUNT(*) as count FROM users');
      const postCount = await db.get('SELECT COUNT(*) as count FROM posts');
      const commentCount = await db.get('SELECT COUNT(*) as count FROM comments');
      
      console.log('\nTable counts:');
      console.log(`  Users: ${userCount.count}`);
      console.log(`  Posts: ${postCount.count}`);
      console.log(`  Comments: ${commentCount.count}`);
      
      // Check if moderation tables exist
      const tables = await db.all(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('reports', 'moderation_logs')
      `);
      
      if (tables.length > 0) {
        console.log('  Moderation tables: ✓');
      }
      
    } catch (error) {
      console.log('  (Could not fetch table statistics)');
    }
  }

  async rollback(migrationName) {
    console.log(`⚠️  Rollback not implemented yet for: ${migrationName}`);
    console.log('Manual rollback may be required.');
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const runner = new MigrationRunner();
  
  switch (command) {
    case 'status':
      await db.connect();
      await runner.ensureMigrationsTable();
      await runner.showStatus();
      await db.close();
      break;
      
    case 'rollback':
      const migrationName = args[1];
      if (!migrationName) {
        console.error('Usage: npm run migrate rollback <migration_name>');
        process.exit(1);
      }
      await runner.rollback(migrationName);
      break;
      
    default:
      await runner.run();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { MigrationRunner };
