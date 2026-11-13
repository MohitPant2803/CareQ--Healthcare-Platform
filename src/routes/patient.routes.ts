import { Router } from 'express';
import { PatientController } from '../controllers/patient.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/rbac.js';
import { validatePatientOwnership } from '../middlewares/ownership.js';
import { auditAccess } from '../middlewares/audit.js';
import { AuditAction } from '../models/AuditLog.js';
import { UserRole } from '../constants/roles.js';

const router = Router();

// IDOR-proof endpoint: Patient views their own profile derived strictly from the JWT
router.get(
  '/me',
  authenticate,
  authorize(UserRole.PATIENT),
  auditAccess('PATIENT_RECORD', AuditAction.READ),
  PatientController.getMyProfile
);

// Specific Patient ID endpoint: Protected by ownership guard
router.get(
  '/:id',
  authenticate,
  validatePatientOwnership,
  auditAccess('PATIENT_RECORD', AuditAction.READ),
  PatientController.getPatientById
);

// Staff-only list endpoint with pagination & search
router.get(
  '/',
  authenticate,
  authorize(UserRole.RECEPTIONIST, UserRole.ADMIN),
  auditAccess('PATIENT_DIRECTORY', AuditAction.READ),
  PatientController.listPatients
);

export default router;
