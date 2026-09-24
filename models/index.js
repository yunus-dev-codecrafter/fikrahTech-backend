const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.js')[env];
const db = {};

let sequelize;
const databaseUrl = process.env.DATABASE_URL ? String(process.env.DATABASE_URL).trim().replace(/^["']|["']$/g, '') : null;

function isLocalHost(host) {
  if (!host) return true;
  const h = String(host).toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

const useSSL = databaseUrl ? !isLocalHost(config.host) : !isLocalHost(config.host);
const baseOptions = {
  dialect: 'postgres',
  logging: env === 'development' ? console.log : false,
  define: config.define,
  pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
  dialectOptions: useSSL ? { ssl: { require: true, rejectUnauthorized: false } } : {},
};

if (databaseUrl) {
  // Primary path: single connection string (Render / Supabase / Neon).
  // Pass options separately — never merge parsed user/pass fields into the URL string.
  sequelize = new Sequelize(databaseUrl, baseOptions);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, {
    ...baseOptions,
    host: config.host,
    port: config.port || 5432,
  });
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
