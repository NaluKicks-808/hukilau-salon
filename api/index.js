'use strict';

/**
 * Vercel serverless entry point.
 *
 * Vercel runs each request through this exported Express app (Fluid Compute / @vercel/node).
 * server.js only calls app.listen() when executed directly (`require.main === module`), so
 * importing it here is safe — Vercel handles the HTTP listener for us.
 *
 * vercel.json rewrites every incoming path to /api, and Express then routes /vapi/tools,
 * /health, etc. internally.
 */

// Pin to salon-local time (no `npm start` wrapper exists in serverless).
process.env.TZ = process.env.TZ || process.env.SALON_TZ || 'Pacific/Honolulu';

const { app } = require('../server');

module.exports = app;
