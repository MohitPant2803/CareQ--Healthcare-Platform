import mongoose from 'mongoose';
import { ENV } from './env.js';

let mongodInstance: any = null;

export const connectDB = async (): Promise<string> => {
  try {
    // Attempt standard connection first
    await mongoose.connect(ENV.MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
    console.log(`[MongoDB] Connected to standalone/replica instance at ${ENV.MONGODB_URI}`);
    return ENV.MONGODB_URI;
  } catch (err) {
    console.warn(`[MongoDB] Local connection to ${ENV.MONGODB_URI} failed. Initializing MongoMemoryServer (Replica Set enabled)...`);
    
    // In-memory replica set allows real MongoDB Transactions & concurrency tests!
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    mongodInstance = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const memoryUri = mongodInstance.getUri();
    await mongoose.connect(memoryUri);
    console.log(`[MongoDB] MongoMemoryReplSet started successfully at: ${memoryUri}`);

    // Ensure collections and indexes are created beforehand so transactions won't fail with catalog conflicts
    const { User } = await import('../models/User.js');
    const { Patient } = await import('../models/Patient.js');
    const { Doctor } = await import('../models/Doctor.js');
    const { Availability } = await import('../models/Availability.js');
    const { Holiday } = await import('../models/Holiday.js');
    const { Appointment } = await import('../models/Appointment.js');
    const { AuditLog } = await import('../models/AuditLog.js');
    await Promise.all([
      User.createCollection(),
      Patient.createCollection(),
      Doctor.createCollection(),
      Availability.createCollection(),
      Holiday.createCollection(),
      Appointment.createCollection(),
      AuditLog.createCollection(),
    ]);
    await Promise.all([
      User.init(),
      Patient.init(),
      Doctor.init(),
      Availability.init(),
      Holiday.init(),
      Appointment.init(),
      AuditLog.init(),
    ]);

    return memoryUri;
  }
};

export const disconnectDB = async () => {
  await mongoose.disconnect();
  if (mongodInstance) {
    await mongodInstance.stop();
  }
};
