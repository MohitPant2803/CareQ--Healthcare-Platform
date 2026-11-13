import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../constants/roles.js';
import { Patient } from '../models/Patient.js';

/**
 * Resource-Level Authorization Guard:
 * Prevents IDOR (Insecure Direct Object References) / BOLA (Broken Object Level Authorization).
 * Ensures that a patient can ONLY access their own records,
 * while allowing staff (RECEPTIONIST, ADMIN) administrative access.
 */
export const validatePatientOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const requestedPatientId = req.params.patientId || req.params.id;
    if (!requestedPatientId) {
      res.status(400).json({ success: false, message: 'Patient ID parameter required' });
      return;
    }

    // Admins and Receptionists have hospital-wide authorization
    if (req.user.role === UserRole.ADMIN || req.user.role === UserRole.RECEPTIONIST) {
      next();
      return;
    }

    // If caller is a PATIENT, they can only access their own profile
    if (req.user.role === UserRole.PATIENT) {
      const patient = await Patient.findById(requestedPatientId);
      if (!patient) {
        res.status(404).json({ success: false, message: 'Patient record not found' });
        return;
      }

      // Check ownership: does patient.userId match req.user.id?
      if (patient.userId.toString() !== req.user.id) {
        // Return 403 Forbidden (or 404 to prevent ID enumeration)
        res.status(403).json({
          success: false,
          message: 'Access Denied: You are not authorized to view or modify this patient record.',
        });
        return;
      }

      // Attach verified patient to request object for downstream controllers
      (req as any).patient = patient;
      next();
      return;
    }

    // Doctors: Doctor can access if they have a scheduled appointment with this patient
    // (We also enforce this in appointment queries)
    if (req.user.role === UserRole.DOCTOR) {
      // In Module 3, we will verify the doctor-patient relationship
      next();
      return;
    }

    res.status(403).json({ success: false, message: 'Access Denied' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Authorization verification failed' });
  }
};
