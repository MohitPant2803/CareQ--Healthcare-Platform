import { Router } from 'express';
import {
  AppointmentController,
  bookAppointmentSchema,
  updateStatusSchema,
  rescheduleSchema,
  cancelSchema,
} from '../controllers/appointment.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/rbac.js';
import { validate } from '../middlewares/validate.js';
import { UserRole } from '../constants/roles.js';

const router = Router();

// All appointment routes require authentication
router.use(authenticate);

// Book an appointment (Patient, Receptionist, Admin)
router.post(
  '/',
  authorize(UserRole.PATIENT, UserRole.RECEPTIONIST, UserRole.ADMIN),
  validate(bookAppointmentSchema),
  AppointmentController.bookAppointment
);

// List appointments with pagination & filters (scoped automatically by role)
router.get('/', AppointmentController.listAppointments);

// Get single appointment details
router.get('/:id', AppointmentController.getAppointmentById);

// Transition appointment status (FSM state machine)
router.patch(
  '/:id/status',
  validate(updateStatusSchema),
  AppointmentController.updateStatus
);

// Reschedule appointment
router.patch(
  '/:id/reschedule',
  validate(rescheduleSchema),
  AppointmentController.reschedule
);

// Cancel appointment
router.delete(
  '/:id',
  validate(cancelSchema),
  AppointmentController.cancel
);

export default router;
