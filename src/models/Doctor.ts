import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDoctor extends Document {
  userId: Types.ObjectId;
  firstName: string;
  lastName: string;
  specialization: string;
  department: string;
  licenseNumber: string;
  appointmentDurationMinutes: number; // e.g. 20, 30 min
  consultationFee: number;
  bio?: string;
}

const DoctorSchema = new Schema<IDoctor>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    specialization: { type: String, required: true, trim: true, index: true },
    department: { type: String, required: true, trim: true, index: true },
    licenseNumber: { type: String, required: true, unique: true, trim: true },
    appointmentDurationMinutes: {
      type: Number,
      required: true,
      default: 20,
      min: [10, 'Minimum slot duration is 10 minutes'],
      max: [120, 'Maximum slot duration is 120 minutes'],
    },
    consultationFee: {
      type: Number,
      required: true,
      min: [0, 'Fee cannot be negative'],
    },
    bio: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

// Compound index for browsing doctors by department & specialization
DoctorSchema.index({ department: 1, specialization: 1 });

export const Doctor = mongoose.model<IDoctor>('Doctor', DoctorSchema);
