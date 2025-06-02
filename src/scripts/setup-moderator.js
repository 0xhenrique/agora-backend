import db from '../database/db.js';
import bcrypt from 'bcrypt';

async function setupModerator() {
  try {
    console.log('Setting up test moderator account...');
    
    // Connect to database
    await db.connect();
    
    const username = 'moderator';
    const password = 'mod123';
    
    // Check if moderator already exists
    const existingMod = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    
    if (existingMod) {
      // Update existing user to moderator role
      await db.run('UPDATE users SET role = ? WHERE username = ?', ['moderator', username]);
      console.log(`Updated existing user '${username}' to moderator role`);
    } else {
      // Create new moderator user
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        [username, passwordHash, 'moderator']
      );
      console.log(`Created new moderator user: ${username} (ID: ${result.id})`);
    }
    
    // Also promote 'admin' user if exists
    const adminUser = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);
    if (adminUser) {
      await db.run('UPDATE users SET role = ? WHERE username = ?', ['admin', 'admin']);
      console.log('Updated admin user to admin role');
    }
    
    console.log('\nModerator setup completed!');
    console.log('Login credentials:');
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    console.log('\nYou can now access moderation endpoints at /api/mod/*');

  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupModerator();
}

export { setupModerator };
