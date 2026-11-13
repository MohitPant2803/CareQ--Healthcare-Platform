import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBreakTime {
  start: string; // e.g. "13:00" (24-hour format)
  end: string;   // e.g. "14:00"
  reason?: string;
}

export interface IAvailability extends Document {
  doctorId: Types.ObjectId;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: string; // e.g. "09:00"
  endTime: string;   // e.g. "17:00"
  slotDurationMinutes: number; // e.g. 20
  breaks: IBreakTime[];
  isWorkingDay: boolean;
}

const BreakTimeSchema = new Schema<IBreakTime>(
  {
    start: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Break start must be in HH:MM (24-hour) format'],
    },
    end: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Break end must be in HH:MM (24-hour) format'],
    },
    reason: { type: String, trim: true },
  },
  { _id: false }
);

const AvailabilitySchema = new Schema<IAvailability>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true,
      index: true,
    },
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    startTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Start time must be in HH:MM (24-hour) format'],
    },
    endTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'End time must be in HH:MM (24-hour) format'],
    },
    slotDurationMinutes: {
      type: Number,
      required: true,
      min: 10,
      max: 120,
      default: 20,
    },
    breaks: {
      type: [BreakTimeSchema],
      default: [],
    },
    isWorkingDay: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// A doctor has at most 1 schedule configuration per day of week
AvailabilitySchema.index({ doctorId: 1, dayOfWeek: 1 }, { unique: true });

export const Availability = mongoose.model<IAvailability>('Availability', AvailabilitySchema);
