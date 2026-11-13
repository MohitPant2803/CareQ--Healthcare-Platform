import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Patient } from '../models/Patient.js';
import { Doctor } from '../models/Doctor.js';
import { AuthService } from '../services/auth.service.js';
import { UserRole } from '../constants/roles.js';

// Validation Schemas
export const registerPatientSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format (YYYY-MM-DD)'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  address: z.object({
    street: z.string().optional(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
  }).optional(),
  emergencyContact: z.object({
    name: z.string(),
    relationship: z.string(),
    phone: z.string(),
  }).optional(),
  allergies: z.array(z.string()).optional(),
});

export const registerDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  specialization: z.string().min(1),
  department: z.string().min(1),
  licenseNumber: z.string().min(1),
  appointmentDurationMinutes: z.number().int().min(10).max(120).default(20),
  consultationFee: z.number().min(0),
  bio: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// Controllers
export class AuthController {
  // Register Patient (Atomic Multi-Document Transaction)
  static async registerPatient(req: Request, res: Response): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        email, password, phone, firstName, lastName,
        dateOfBirth, gender, bloodGroup, address, emergencyContact, allergies
      } = req.body;

      // Check if email already registered
      const existingUser = await User.findOne({ email }).session(session);
      if (existingUser) {
        await session.abortTransaction();
        res.status(409).json({ success: false, message: 'Email already registered' });
        return;
      }

      // 1. Create User Identity
      const user = new User({
        email,
        password,
        phone,
        role: UserRole.PATIENT,
      });
      await user.save({ session });

      // 2. Create Patient Profile referenced to User
      const patient = new Patient({
        userId: user._id,
        firstName,
        lastName,
        dateOfBirth: new Date(dateOfBirth),
        gender,
        bloodGroup,
        address,
        emergencyContact,
        allergies: allergies || [],
      });
      await patient.save({ session });

      await session.commitTransaction();

      // Issue tokens
      const tokens = await AuthService.issueTokenPair(user);

      res.status(201).json({
        success: true,
        message: 'Patient registered successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
          },
          patient: {
            id: patient._id,
            firstName: patient.firstName,
            lastName: patient.lastName,
          },
          tokens,
        },
      });
    } catch (err: any) {
      console.error('Registration Error:', err);
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      res.status(500).json({ success: false, message: err.message || 'Registration failed' });
    } finally {
      session.endSession();
    }
  }

  // Register Doctor (Atomic Multi-Document Transaction)
  static async registerDoctor(req: Request, res: Response): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        email, password, phone, firstName, lastName,
        specialization, department, licenseNumber, appointmentDurationMinutes, consultationFee, bio
      } = req.body;

      const existingUser = await User.findOne({ email }).session(session);
      if (existingUser) {
        await session.abortTransaction();
        res.status(409).json({ success: false, message: 'Email already registered' });
        return;
      }

      const existingLicense = await Doctor.findOne({ licenseNumber }).session(session);
      if (existingLicense) {
        await session.abortTransaction();
        res.status(409).json({ success: false, message: 'License number already in use' });
        return;
      }

      const user = new User({
        email,
        password,
        phone,
        role: UserRole.DOCTOR,
      });
      await user.save({ session });

      const doctor = new Doctor({
        userId: user._id,
        firstName,
        lastName,
        specialization,
        department,
        licenseNumber,
        appointmentDurationMinutes: appointmentDurationMinutes || 20,
        consultationFee,
        bio,
      });
      await doctor.save({ session });

      await session.commitTransaction();

      const tokens = await AuthService.issueTokenPair(user);

      res.status(201).json({
        success: true,
        message: 'Doctor registered successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
          },
          doctor: {
            id: doctor._id,
            firstName: doctor.firstName,
            lastName: doctor.lastName,
            specialization: doctor.specialization,
          },
          tokens,
        },
      });
    } catch (err: any) {
      console.error('Registration Error:', err);
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      res.status(500).json({ success: false, message: err.message || 'Registration failed' });
    } finally {
      session.endSession();
    }
  }

  // Login
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      // Must explicitly select password because select: false was defined on the schema
      const user = await User.findOne({ email }).select('+password +refreshTokens');
      if (!user || !user.isActive) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }

      const tokens = await AuthService.issueTokenPair(user);

      // Fetch corresponding profile based on role
      let profile: any = null;
      if (user.role === UserRole.PATIENT) {
        profile = await Patient.findOne({ userId: user._id });
      } else if (user.role === UserRole.DOCTOR) {
        profile = await Doctor.findOne({ userId: user._id });
      }

      res.status(200).json({
        success: true,
        message: 'Logged in successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            role: user.role,
          },
          profile,
          tokens,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Login failed' });
    }
  }

  // Refresh Token Rotation
  static async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;
      const tokens = await AuthService.rotateRefreshToken(refreshToken);
      res.status(200).json({
        success: true,
        message: 'Tokens rotated successfully',
        data: tokens,
      });
    } catch (err: any) {
      res.status(401).json({ success: false, message: err.message || 'Token refresh failed' });
    }
  }

  // Logout
  static async logout(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;
      if (req.user && refreshToken) {
        await AuthService.revokeRefreshToken(req.user.id, refreshToken);
      }
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  }
}
