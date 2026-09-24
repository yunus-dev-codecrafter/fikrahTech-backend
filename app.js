require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const allRoutes = require('./routes'); // Import the consolidated routes

const allowedOrigins = [
  'https://fikrahtech.vercel.app',
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-section-id'],
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// Health endpoints for Render port scan / health checks. Must stay DB-free
// so the service reports healthy even while Postgres is reconnecting.
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'fikrahtech-backend' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Minimal security headers (no new dependencies)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Mount all routes under /api
app.use('/api', allRoutes);

// 404 for unknown API routes (JSON, not HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API route not found.' });
});

// Central error handler — never leak stacks to clients in production
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({
    message: status === 500 ? 'Internal server error.' : (err.message || 'Request failed.'),
  });
});

module.exports = app;
