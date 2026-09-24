require('dotenv').config(); // Load environment variables

// Parse DATABASE_URL if available (Render / Railway / Supabase / Neon provide this).
// Supports both postgres:// and postgresql:// schemes.
// Never logs passwords or the full URL.
function parseDatabaseUrl(url) {
  if (!url) return null;

  const trimmed = String(url).trim().replace(/^["']|["']$/g, '');
  // Normalize scheme so `new URL` always works; pg accepts both.
  const normalized = trimmed.replace(/^postgresql:\/\//i, 'postgres://');

  try {
    const urlObj = new URL(normalized);
    const database = decodeURIComponent(urlObj.pathname.replace(/^\//, '').split('?')[0]);
    const config = {
      host: urlObj.hostname,
      port: urlObj.port || 5432,
      database,
      username: decodeURIComponent(urlObj.username),
      // Keep encoded chars (%40, %23, ...) intact by decoding once.
      password: decodeURIComponent(urlObj.password),
    };
    return config;
  } catch (error) {
    console.error('❌ Invalid DATABASE_URL format. Make sure special chars in the password are URL-encoded.');
    return null;
  }
}

// SSL is required for hosted Postgres (Render / Supabase / Neon / Railway).
// Localhost does not need it.
function needsSSL(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  return !(h === 'localhost' || h === '127.0.0.1' || h === '::1');
}

// Check for DATABASE_URL first (hosted), then fall back to individual vars
const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
const dbConfig = parsed || {
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
};

// Validate required database configuration
if (!dbConfig.host || !dbConfig.username || !dbConfig.password || !dbConfig.database) {
  console.error('❌ DATABASE CONFIGURATION ERROR:');
  console.error('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
  console.error('DB_HOST:', process.env.DB_HOST || 'NOT SET');
  console.error('DB_USERNAME:', process.env.DB_USERNAME || 'NOT SET');
  console.error('DB_DATABASE:', process.env.DB_DATABASE || 'NOT SET');
  console.error('DB_PASSWORD:', process.env.DB_PASSWORD ? 'SET' : 'NOT SET');
  throw new Error('Missing required database configuration. Check environment variables.');
}

console.log('✅ Database Configuration:');
console.log('Host:', dbConfig.host);
console.log('Port:', dbConfig.port);
console.log('Database:', dbConfig.database);
console.log('Username:', dbConfig.username);
console.log('Source:', parsed ? 'DATABASE_URL' : 'individual DB_* vars');
if (parsed && String(dbConfig.port) === '6543') {
  console.log('ℹ️  Port 6543 detected (Supabase pooler). If you see "tenant/user not found", re-copy the pooled URL from Supabase Dashboard > Connect > Transaction mode and URL-encode the password.');
}

const useSSL = needsSSL(dbConfig.host);
const dialectOptions = useSSL
  ? { ssl: { require: true, rejectUnauthorized: false } }
  : {};

module.exports = {
  development: {
    ...dbConfig,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development',
    dialectOptions,
    define: {
      timestamps: true,
      underscored: true
    }
  },
  production: {
    ...dbConfig,
    dialect: 'postgres',
    logging: false,
    dialectOptions,
    define: {
      timestamps: true,
      underscored: true
    }
  },
};