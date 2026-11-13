import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  PORT: process.env.PORT || '5000',
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/careq_db',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'careq_access_secret_super_secure_key_123',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'careq_refresh_secret_super_secure_key_456',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
};
