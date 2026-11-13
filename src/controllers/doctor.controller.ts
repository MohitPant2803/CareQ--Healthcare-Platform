import { Request, Response } from 'express';
import { z } from 'zod';
import { Doctor } from '../models/Doctor.js';
import { Availability } from '../models/Availability.js';
import { Holiday } from '../models/Holiday.js';
import { SlotService } from '../services/slot.service.js';
import { UserRole } from '../constants/roles.js';

export const setAvailabilitySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format HH:MM'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format HH:MM'),
  slotDurationMinutes: z.number().int().min(10).max(120).default(20),
  breaks: z
    .array(
      z.object({
        start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        reason: z.string().optional(),
      })
    )
    .optional(),
  isWorkingDay: z.boolean().default(true),
});

export const addHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD'),
  reason: z.string().optional(),
});

export class DoctorController {
  // Set / Modify Availability (Doctor self or Admin)
  static async setAvailability(req: Request, res: Response): Promise<void> {
    try {
      const { doctorId } = req.params;
      const doctor = await Doctor.findById(doctorId);
      if (!doctor) {
        res.status(404).json({ success: false, message: 'Doctor not found' });
        return;
      }

      // Authorization: Only the doctor themselves or Admin can configure availability
      if (req.user!.role === UserRole.DOCTOR && doctor.userId.toString() !== req.user!.id) {
        res.status(403).json({ success: false, message: 'Unauthorized: Cannot modify another doctor schedule' });
        return;
      }

      const { dayOfWeek, startTime, endTime, slotDurationMinutes, breaks, isWorkingDay } = req.body;

      const updated = await Availability.findOneAndUpdate(
        { doctorId, dayOfWeek },
        {
          startTime,
          endTime,
          slotDurationMinutes: slotDurationMinutes || doctor.appointmentDurationMinutes,
          breaks: breaks || [],
          isWorkingDay: isWorkingDay !== undefined ? isWorkingDay : true,
        },
        { upsert: true, returnDocument: 'after', runValidators: true }
      );

      res.status(200).json({
        success: true,
        message: 'Doctor availability configured successfully',
        data: updated,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to set availability' });
    }
  }

  // Add Holiday / Vacation
  static async addHoliday(req: Request, res: Response): Promise<void> {
    try {
      const { doctorId } = req.params;
      const { date, reason } = req.body;

      const holiday = await Holiday.findOneAndUpdate(
        { doctorId, date },
        { reason },
        { upsert: true, returnDocument: 'after' }
      );

      res.status(200).json({
        success: true,
        message: 'Holiday scheduled successfully',
        data: holiday,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to add holiday' });
    }
  }

  // Get Available Slots for Doctor on a specific date
  static async getSlots(req: Request, res: Response): Promise<void> {
    try {
      const doctorId = req.params.doctorId as string;
      const { date } = req.query;

      if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({
          success: false,
          message: 'Valid date query parameter required (format: YYYY-MM-DD)',
        });
        return;
      }

      const result = await SlotService.getDoctorSlotsForDate(doctorId, date);
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to generate slots' });
    }
  }

  // List all doctors
  static async listDoctors(req: Request, res: Response): Promise<void> {
    try {
      const doctors = await Doctor.find().populate('userId', 'email phone');
      res.status(200).json({ success: true, data: doctors });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Failed to list doctors' });
    }
  }
}
