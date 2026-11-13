import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface IAddress {
  street?: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface IPatient extends Document {
  userId: Types.ObjectId;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  bloodGroup?: string;
  address?: IAddress;
  emergencyContact?: IEmergencyContact;
  allergies: string[];
  medicalNotes?: string;
}

const AddressSchema = new Schema<IAddress>(
  {
    street: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    zipCode: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const EmergencyContactSchema = new Schema<IEmergencyContact>(
  {
    name: { type: String, required: true, trim: true },
    relationship: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const PatientSchema = new Schema<IPatient>(
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
    dateOfBirth: { type: Date, required: true },
    gender: {
      type: String,
      enum: ['MALE', 'FEMALE', 'OTHER'],
      required: true,
    },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    },
    address: AddressSchema,
    emergencyContact: EmergencyContactSchema,
    allergies: {
      type: [String],
      default: [],
    },
    medicalNotes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for patient search (e.g. reception search by name)
PatientSchema.index({ lastName: 1, firstName: 1 });

export const Patient = mongoose.model<IPatient>('Patient', PatientSchema);
