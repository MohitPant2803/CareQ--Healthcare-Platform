import mongoose, { Schema, Document, Types } from 'mongoose';
import { AppointmentStatus } from '../constants/appointment-status.js';

export interface IRescheduleEntry {
  previousSlotStartTime: Date;
  previousSlotEndTime: Date;
  rescheduledAt: Date;
  rescheduledBy: Types.ObjectId;
}

export interface IAppointment extends Document {
  doctorId: Types.ObjectId;
  patientId: Types.ObjectId;
  slotStartTime: Date;
  slotEndTime: Date;
  status: AppointmentStatus;
  bookedBy: Types.ObjectId;
  reasonForVisit?: string;
  notes?: string;
  idempotencyKey?: string;
  cancellationReason?: string;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  rescheduleHistory: IRescheduleEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    slotStartTime: {
      type: Date,
      required: true,
      index: true,
    },
    slotEndTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(AppointmentStatus),
      default: AppointmentStatus.CONFIRMED,
      required: true,
      index: true,
    },
    bookedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reasonForVisit: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    idempotencyKey: {
      type: String,
      sparse: true,
      unique: true,
    },
    cancellationReason: {
      type: String,
      trim: true,
    },
    cancelledAt: {
      type: Date,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    rescheduleHistory: {
      type: [
        {
          previousSlotStartTime: { type: Date, required: true },
          previousSlotEndTime: { type: Date, required: true },
          rescheduledAt: { type: Date, required: true },
          rescheduledBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

/**
 * CRITICAL DATABASE CONCURRENCY GUARANTEE:
 * Unique Compound Partial Filter Index.
 *
 * Guarantees that at most ONE active appointment can exist for a given doctor
 * at a given slot start time.
 * If status is CANCELLED or NO_SHOW, the partial filter excludes it,
 * immediately freeing up the slot without losing audit history!
 */
AppointmentSchema.index(
  { doctorId: 1, slotStartTime: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          AppointmentStatus.REQUESTED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.IN_PROGRESS,
        ],
      },
    },
  }
);

// Performance compound index for Doctor schedule lookups (ESR Rule: Equality, Sort, Range)
AppointmentSchema.index({ doctorId: 1, slotStartTime: 1, status: 1 });

// Performance index for Patient appointment history
AppointmentSchema.index({ patientId: 1, slotStartTime: -1 });

export const Appointment = mongoose.model<IAppointment>('Appointment', AppointmentSchema);
