import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { requireAdmin } from './auth.js';
import authRoutes from './routes/auth.js';
import userAuthRoutes from './routes/userAuth.js';
import adminRoutes from './routes/admin.js';
import knowledgeRoutes from './routes/knowledge.js';
import analyzeRoutes from './routes/analyze.js';
import paymentRoutes from './routes/payments.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin) return callback(null, true);
        if (!config.corsOrigins.length) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  // Chart screenshots arrive as base64 JSON, so the JSON body needs more room
  // than the default. PDF uploads have their own multer limit.
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'ai-trading-backend', time: new Date().toISOString() });
  });

  // App users: signup, login, session, activation codes.
  app.use('/api/auth', userAuthRoutes);

  // Admin: login/session (authRoutes) plus the management endpoints.
  app.use('/api/admin', authRoutes);
  app.use('/api/admin/knowledge', requireAdmin, knowledgeRoutes);
  app.use('/api/admin', requireAdmin, adminRoutes);

  // Crypto (USDT) payment intents and on-chain verification.
  app.use('/api/payments', paymentRoutes);

  // Chart analysis requires a signed-in, activated app user.
  app.use('/api', analyzeRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // Central error handler. Multer and validation errors carry a status.
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `File is too large (max ${config.uploads.maxMb} MB)`
        : error.type === 'entity.too.large'
          ? 'The screenshot payload is too large. Send a smaller JPEG (max 15 MB).'
          : error.message || 'Internal server error';

    if (status >= 500) {
      console.error('[error]', error);
    }

    if (res.headersSent) return;
    res.status(status).json({ error: message });
  });

  return app;
}
