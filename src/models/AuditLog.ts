import mongoose, { Schema, Document, Types } from 'mongoose';
import { UserRole } from '../constants/roles.js';

export enum AuditAction {
  READ = 'READ',
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  STATUS_CHANGE = 'STATUS_CHANGE',
  AUTH_LOGIN = 'AUTH_LOGIN',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  ACCESS_DENIED = 'ACCESS_DENIED',
}

export interface IAuditLog extends Document {
  userId?: Types.ObjectId;
  userRole?: UserRole;
  userEmail?: string;
  action: AuditAction;
  resource: string; // e.g. "PATIENT_RECORD", "APPOINTMENT", "AUTH"
  resourceId?: string;
  patientId?: Types.ObjectId;
  ipAddress: string;
  userAgent?: string;
  status: 'SUCCESS' | 'FAILURE';
  reason?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userRole: { type: String, enum: Object.values(UserRole) },
    userEmail: { type: String, trim: true },
    action: { type: String, enum: Object.values(AuditAction), required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', index: true },
    ipAddress: { type: String, required: true },
    userAgent: { type: String },
    status: { type: String, enum: ['SUCCESS', 'FAILURE'], required: true },
    reason: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Immutable append-only audit trail
  }
);

// Compound index for compliance investigation: "Show all accesses to Patient X ordered by time"
AuditLogSchema.index({ patientId: 1, createdAt: -1 });

// Compound index for user access audits: "Show all actions taken by User Y"
AuditLogSchema.index({ userId: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
