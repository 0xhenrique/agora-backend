import db from '../database/db.js';
import bcrypt from 'bcrypt';

async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    
    // Connect and create schema
    await db.connect();
    
    // Create some test users (optional)
    const testUsers = [
      { username: 'admin', password: 'admin123' },
      { username: 'testuser1', password: 'password123' },
      { username: 'testuser2', password: 'password123' }
    ];

    console.log('Creating test users...');
    for (const user of testUsers) {
      try {
        const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [user.username]);
        if (!existingUser) {
          const passwordHash = await bcrypt.hash(user.password, 12);
          await db.run(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            [user.username, passwordHash]
          );
          console.log(`Created user: ${user.username}`);
        } else {
          console.log(`User ${user.username} already exists`);
        }
      } catch (error) {
        console.error(`Error creating user ${user.username}:`, error.message);
      }
    }

    // Create some test posts (optional)
    console.log('Creating test posts...');
    const testPosts = [
      {
        title: 'Welcome to the Political Forum',
        body: 'This is a test post to demonstrate the forum functionality. Feel free to comment and vote!',
        author: 'admin'
      },
      {
        title: 'Discussion: Current Political Climate',
        body: 'What are your thoughts on the current political situation? Let\'s have a civilized discussion.',
        url: 'https://example.com/political-news',
        author: 'testuser1'
      },
      {
        title: 'Image Post Example',
        body: 'This is an example of a post with an image.',
        imageUrl: 'https://via.placeholder.com/400x300?text=Political+Forum',
        author: 'testuser2'
      }
    ];

    for (const post of testPosts) {
      try {
        // Get author ID
        const author = await db.get('SELECT id FROM users WHERE username = ?', [post.author]);
        if (author) {
          await db.run(`
            INSERT INTO posts (title, url, image_url, body, author_id)
            VALUES (?, ?, ?, ?, ?)
          `, [
            post.title,
            post.url || null,
            post.imageUrl || null,
            post.body,
            author.id
          ]);
          console.log(`Created post: ${post.title}`);
        }
      } catch (error) {
        console.error(`Error creating post ${post.title}:`, error.message);
      }
    }

    // Create some test comments
    console.log('Creating test comments...');
    const posts = await db.all('SELECT id FROM posts LIMIT 2');
    if (posts.length > 0) {
      const users = await db.all('SELECT id, username FROM users WHERE username != "admin"');
      
      for (const user of users) {
        try {
          await db.run(`
            INSERT INTO comments (post_id, author_id, body)
            VALUES (?, ?, ?)
          `, [
            posts[0].id,
            user.id,
            `This is a test comment from ${user.username}. Great post!`
          ]);
          console.log(`Created comment from ${user.username}`);
        } catch (error) {
          console.error(`Error creating comment:`, error.message);
        }
      }
    }

    console.log('Database initialization completed successfully!');
    
    // Display summary
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    const postCount = await db.get('SELECT COUNT(*) as count FROM posts');
    const commentCount = await db.get('SELECT COUNT(*) as count FROM comments');
    
    console.log('\n=== Database Summary ===');
    console.log(`Users: ${userCount.count}`);
    console.log(`Posts: ${postCount.count}`);
    console.log(`Comments: ${commentCount.count}`);
    console.log('========================\n');

  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase();
}
