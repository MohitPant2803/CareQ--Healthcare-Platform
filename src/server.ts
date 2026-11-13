import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { ENV } from './config/env.js';

const startServer = async () => {
  try {
    await connectDB();
    const app = createApp();
    const PORT = parseInt(ENV.PORT, 10) || 5000;

    app.listen(PORT, () => {
      console.log(`CareQ Server running in ${ENV.NODE_ENV} mode on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
