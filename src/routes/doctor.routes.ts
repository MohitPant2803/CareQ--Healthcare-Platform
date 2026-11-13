import { Router } from 'express';
import {
  DoctorController,
  setAvailabilitySchema,
  addHolidaySchema,
} from '../controllers/doctor.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/rbac.js';
import { validate } from '../middlewares/validate.js';
import { UserRole } from '../constants/roles.js';

const router = Router();

// Public: List all doctors
router.get('/', DoctorController.listDoctors);

// Public / Patient: Retrieve available slots for a doctor on a specific date
router.get('/:doctorId/slots', DoctorController.getSlots);

// Doctor / Admin: Configure weekly availability
router.post(
  '/:doctorId/availability',
  authenticate,
  authorize(UserRole.DOCTOR, UserRole.ADMIN),
  validate(setAvailabilitySchema),
  DoctorController.setAvailability
);

// Doctor / Admin: Add holiday / blackout date
router.post(
  '/:doctorId/holidays',
  authenticate,
  authorize(UserRole.DOCTOR, UserRole.ADMIN),
  validate(addHolidaySchema),
  DoctorController.addHoliday
);

export default router;
