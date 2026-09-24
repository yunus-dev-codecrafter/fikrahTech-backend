require('dotenv').config();
const app = require('./app');
const db = require('./models'); // Import the Sequelize instance
const { bootstrapSystem } = require('./utils/bootstrap');

// Check JWT_SECRET status
if (process.env.JWT_SECRET) {
  console.log('✅ KEY FOUND: JWT_SECRET is configured');
} else {
  console.log('❌ KEY MISSING: JWT_SECRET is not configured');
}

const PORT = process.env.PORT || 3000;

// Render must see an open port immediately, otherwise it marks the service
// "Failed" with "No open ports detected". So bind first, then init the DB.
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initDatabase().catch((err) => {
    console.error('Database init failed after boot (server still listening):', err.message);
  });
});

async function initDatabase() {
  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Syncing database schema with PostgreSQL... (attempt ${attempt}/${maxRetries})`);
      await db.sequelize.authenticate();
      await db.sequelize.sync();

      console.log('Database synced successfully.');

      // Log total users count on startup for database verification
      const { User } = db;
      const userCount = await User.count();
      console.log('TOTAL USERS IN DB:', userCount);

      // Run system bootstrap after database sync
      const bootstrapResult = await bootstrapSystem();

      if (bootstrapResult.success) {
        console.log(' FikrahTech is ready for operation!');
      } else {
        console.log(' Server starting with bootstrap warnings...');
      }
      return;
    } catch (err) {
      // Supabase pooler auth errors (XX000 tenant/user not found) mean the
      // DATABASE_URL itself is wrong — retrying won't help, so fail fast here
      // but keep the HTTP server up so Render doesn't report "no open ports".
      const code = err?.original?.code || err?.parent?.code;
      const msg = String(err?.original?.message || err?.message || '');
      if (code === 'XX000' || /tenant\/user.*not found/i.test(msg)) {
        console.error('❌ DATABASE_URL rejected by Postgres (tenant/user not found). Re-copy it from Supabase Dashboard > Connect and URL-encode the password. Server stays up for health checks.');
        console.error(err.message);
        return;
      }
      console.error(`Database attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries) {
        console.error('Unable to connect to the database after retries. Server stays up; /health still returns 200.');
        return;
      }
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

module.exports = server;
