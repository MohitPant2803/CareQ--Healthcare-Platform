import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.routes.js';
import patientRoutes from './routes/patient.routes.js';
import doctorRoutes from './routes/doctor.routes.js';
import appointmentRoutes from './routes/appointment.routes.js';

export const createApp = () => {
  const app = express();

  // 1. Security Headers
  app.use(helmet());

  // 2. Cross-Origin Resource Sharing
  app.use(cors());

  // 3. Request body parsing with strict size limit (prevents memory exhaustion)
  app.use(express.json({ limit: '10kb' }));

  // 4. Sanitize data against NoSQL query injection (strips keys starting with $ or containing .)
  app.use((req, res, next) => {
    const sanitize = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      for (const key of Object.keys(obj)) {
        if (key.startsWith('$') || key.includes('.')) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          sanitize(obj[key]);
        }
      }
      return obj;
    };
    if (req.body) sanitize(req.body);
    if (req.params) sanitize(req.params);
    next();
  });

  // 5. Rate Limiter (Brute-force protection on auth endpoints)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests from this IP, please try again later.' },
  });
  app.use('/api/v1/auth', authLimiter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'CareQ Healthcare Engine' });
  });

  // Mount API Modules
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/patients', patientRoutes);
  app.use('/api/v1/doctors', doctorRoutes);
  app.use('/api/v1/appointments', appointmentRoutes);

  // 404 Route Catch-all
  app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
  });

  // Global Error Handler (Sanitized responses - Zero Information Leakage)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';

    // Mask internal error details for 500 responses
    const responseMessage =
      status >= 500 && isProd
        ? 'An unexpected error occurred on the server. Please contact support.'
        : err.message || 'Internal server error';

    res.status(status).json({
      success: false,
      status,
      message: responseMessage,
    });
  });

  return app;
};
