import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserRole } from '../constants/roles.js';

export interface IUser extends Document {
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  refreshTokens: string[]; // Store active refresh token hashes for session control
  passwordChangedAt?: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Omit from default queries to prevent accidental leakage in API responses
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.PATIENT,
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshTokens: {
      type: [String],
      default: [],
      select: false,
    },
    passwordChangedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving if modified
UserSchema.pre<IUser>('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  if (!this.isNew) {
    this.passwordChangedAt = new Date(Date.now() - 1000); // 1s in the past to ensure JWT timestamp is after
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
