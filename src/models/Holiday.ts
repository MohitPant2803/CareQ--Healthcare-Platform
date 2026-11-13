import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IHoliday extends Document {
  doctorId: Types.ObjectId;
  date: string; // ISO date string "YYYY-MM-DD"
  reason?: string;
}

const HolidaySchema = new Schema<IHoliday>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'],
    },
    reason: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate holiday entries for the same doctor on the same date
HolidaySchema.index({ doctorId: 1, date: 1 }, { unique: true });

export const Holiday = mongoose.model<IHoliday>('Holiday', HolidaySchema);
