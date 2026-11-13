import { Request, Response } from 'express';
import { z } from 'zod';
import { AppointmentService } from '../services/appointment.service.js';
import { Appointment } from '../models/Appointment.js';
import { Patient } from '../models/Patient.js';
import { Doctor } from '../models/Doctor.js';
import { UserRole } from '../constants/roles.js';
import { AppointmentStatus } from '../constants/appointment-status.js';

export const bookAppointmentSchema = z.object({
  doctorId: z.string().min(1, 'Doctor ID is required'),
  patientId: z.string().min(1, 'Patient ID is required'),
  slotStartTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Valid UTC ISO date string required'),
  slotEndTime: z.string().optional(),
  reasonForVisit: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const updateStatusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus),
  cancellationReason: z.string().optional(),
  notes: z.string().optional(),
});

export const rescheduleSchema = z.object({
  newSlotStartTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Valid UTC ISO date string required'),
});

export const cancelSchema = z.object({
  reason: z.string().optional(),
});

export class AppointmentController {
  // Book an appointment (Patient or Receptionist)
  static async bookAppointment(req: Request, res: Response): Promise<void> {
    try {
      const { doctorId, patientId, slotStartTime, slotEndTime, reasonForVisit, notes, idempotencyKey } = req.body;

      // Ownership Security Check:
      // If caller is a PATIENT, verify that the patientId belongs to their authenticated user account!
      if (req.user!.role === UserRole.PATIENT) {
        const patient = await Patient.findById(patientId);
        if (!patient || patient.userId.toString() !== req.user!.id) {
          res.status(403).json({
            success: false,
            message: 'Forbidden: You can only book appointments for yourself.',
          });
          return;
        }
      }

      const appointment = await AppointmentService.bookAppointment({
        doctorId,
        patientId,
        slotStartTime,
        slotEndTime,
        bookedBy: req.user!.id,
        reasonForVisit,
        notes,
        idempotencyKey,
      });

      res.status(201).json({
        success: true,
        message: 'Appointment booked successfully',
        data: appointment,
      });
    } catch (err: any) {
      if (err.statusCode === 409) {
        res.status(409).json({
          success: false,
          code: 'BOOKING_CONFLICT',
          message: err.message,
        });
        return;
      }
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Failed to book appointment',
      });
    }
  }

  // Update appointment status (FSM transition)
  static async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { status, cancellationReason, notes } = req.body;

      const updated = await AppointmentService.transitionStatus(
        id,
        status,
        { id: req.user!.id, role: req.user!.role },
        { cancellationReason, notes }
      );

      res.status(200).json({
        success: true,
        message: `Appointment status transitioned to ${status}`,
        data: updated,
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Failed to update appointment status',
      });
    }
  }

  // Reschedule an appointment
  static async reschedule(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { newSlotStartTime } = req.body;

      const rescheduled = await AppointmentService.rescheduleAppointment(
        id,
        newSlotStartTime,
        { id: req.user!.id, role: req.user!.role }
      );

      res.status(200).json({
        success: true,
        message: 'Appointment rescheduled successfully',
        data: rescheduled,
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Failed to reschedule appointment',
      });
    }
  }

  // Cancel an appointment
  static async cancel(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const reason = req.body.reason || 'Cancelled by user';

      const cancelled = await AppointmentService.transitionStatus(
        id,
        AppointmentStatus.CANCELLED,
        { id: req.user!.id, role: req.user!.role },
        { cancellationReason: reason }
      );

      res.status(200).json({
        success: true,
        message: 'Appointment cancelled successfully',
        data: cancelled,
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Failed to cancel appointment',
      });
    }
  }

  // Get Appointment Details
  static async getAppointmentById(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const appointment = await Appointment.findById(id)
        .populate('doctorId', 'firstName lastName specialization department')
        .populate('patientId', 'firstName lastName dateOfBirth gender');

      if (!appointment) {
        res.status(404).json({ success: false, message: 'Appointment not found' });
        return;
      }

      // Authorization Check
      if (req.user!.role === UserRole.PATIENT) {
        const patient = await Patient.findOne({ userId: req.user!.id });
        if (!patient || appointment.patientId._id.toString() !== patient._id.toString()) {
          res.status(403).json({ success: false, message: 'Forbidden: Not your appointment' });
          return;
        }
      } else if (req.user!.role === UserRole.DOCTOR) {
        const doctor = await Doctor.findOne({ userId: req.user!.id });
        if (!doctor || appointment.doctorId._id.toString() !== doctor._id.toString()) {
          res.status(403).json({ success: false, message: 'Forbidden: Not your appointment' });
          return;
        }
      }

      res.status(200).json({ success: true, data: appointment });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Failed to retrieve appointment' });
    }
  }

  // List Appointments with Filtering and Pagination
  static async listAppointments(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, cursor, doctorId, patientId, status, startDate, endDate } = req.query;

      const queryParams: any = {
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        cursor: cursor as string,
        status: status as AppointmentStatus,
        startDate: startDate as string,
        endDate: endDate as string,
      };

      // Scope queries according to caller's role (BOLA prevention)
      if (req.user!.role === UserRole.PATIENT) {
        const patient = await Patient.findOne({ userId: req.user!.id });
        if (!patient) {
          res.status(404).json({ success: false, message: 'Patient profile not found' });
          return;
        }
        queryParams.patientId = patient._id.toString();
      } else if (req.user!.role === UserRole.DOCTOR) {
        const doctor = await Doctor.findOne({ userId: req.user!.id });
        if (!doctor) {
          res.status(404).json({ success: false, message: 'Doctor profile not found' });
          return;
        }
        queryParams.doctorId = doctor._id.toString();
      } else {
        // Staff can filter by any doctor or patient
        if (doctorId) queryParams.doctorId = doctorId as string;
        if (patientId) queryParams.patientId = patientId as string;
      }

      const result = await AppointmentService.getAppointments(queryParams);
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Failed to query appointments' });
    }
  }
}
