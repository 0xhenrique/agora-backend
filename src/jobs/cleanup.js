import cron from 'node-cron';
import db from '../database/db.js';

// Delete posts older than 48 hours and their associated data
async function cleanupOldPosts() {
  try {
    console.log('Starting cleanup job...');
    
    // Get posts older than 48 hours
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
    const oldPosts = await db.all(
      'SELECT id, title FROM posts WHERE created_at < ?',
      [cutoffTime.toISOString()]
    );

    if (oldPosts.length === 0) {
      console.log('No posts to clean up');
      return;
    }

    console.log(`Found ${oldPosts.length} posts to delete`);

    // Delete posts (cascade will handle comments and votes)
    const result = await db.run(
      'DELETE FROM posts WHERE created_at < ?',
      [cutoffTime.toISOString()]
    );

    console.log(`Cleanup completed: ${result.changes} posts deleted`);
    
    // Log some stats
    const remainingPosts = await db.get('SELECT COUNT(*) as count FROM posts');
    const remainingComments = await db.get('SELECT COUNT(*) as count FROM comments');
    const remainingVotes = await db.get('SELECT COUNT(*) as count FROM votes');
    
    console.log(`Database stats after cleanup:`);
    console.log(`  Posts: ${remainingPosts.count}`);
    console.log(`  Comments: ${remainingComments.count}`);
    console.log(`  Votes: ${remainingVotes.count}`);

  } catch (error) {
    console.error('Cleanup job error:', error);
  }
}

// Run cleanup every hour
export function startCleanupJob() {
  // Run immediately on startup
  cleanupOldPosts();
  
  // Schedule to run every hour
  cron.schedule('0 * * * *', () => {
    cleanupOldPosts();
  });
  
  console.log('Cleanup job scheduled to run every hour');
}

// Manual cleanup function for testing
export { cleanupOldPosts };
