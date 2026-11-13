import { Request, Response } from 'express';
import { Patient } from '../models/Patient.js';
import { UserRole } from '../constants/roles.js';

export class PatientController {
  // Get Current Patient Profile (/patients/me) - IDOR-proof by design
  static async getMyProfile(req: Request, res: Response): Promise<void> {
    try {
      const patient = await Patient.findOne({ userId: req.user!.id }).populate('userId', 'email phone');
      if (!patient) {
        res.status(404).json({ success: false, message: 'Patient profile not found' });
        return;
      }
      res.status(200).json({ success: true, data: patient });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Failed to retrieve profile' });
    }
  }

  // Get Patient By ID - protected by validatePatientOwnership middleware
  static async getPatientById(req: Request, res: Response): Promise<void> {
    try {
      // If validatePatientOwnership middleware already validated and attached the patient:
      const existingPatient = (req as any).patient;
      if (existingPatient) {
        res.status(200).json({ success: true, data: existingPatient });
        return;
      }

      const patient = await Patient.findById(req.params.id).populate('userId', 'email phone');
      if (!patient) {
        res.status(404).json({ success: false, message: 'Patient not found' });
        return;
      }

      res.status(200).json({ success: true, data: patient });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Failed to retrieve patient' });
    }
  }

  // List all patients (Staff only: RECEPTIONIST, ADMIN) with pagination
  static async listPatients(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
      const skip = (page - 1) * limit;

      const filter: any = {};
      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search as string, 'i');
        filter.$or = [{ firstName: searchRegex }, { lastName: searchRegex }];
      }

      const [patients, total] = await Promise.all([
        Patient.find(filter)
          .sort({ lastName: 1, firstName: 1 })
          .skip(skip)
          .limit(limit)
          .populate('userId', 'email phone'),
        Patient.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        data: {
          patients,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Failed to list patients' });
    }
  }
}
