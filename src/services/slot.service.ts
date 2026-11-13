import { Types } from 'mongoose';
import { Availability } from '../models/Availability.js';
import { Holiday } from '../models/Holiday.js';
import { Appointment } from '../models/Appointment.js';
import { AppointmentStatus } from '../constants/appointment-status.js';

export interface GeneratedSlot {
  startTime: string; // ISO UTC string
  endTime: string;   // ISO UTC string
  displayTime: string; // e.g. "09:00 - 09:20"
  status: 'AVAILABLE' | 'BOOKED' | 'BREAK';
}

export class SlotService {
  /**
   * Helper: Convert "HH:MM" 24-hr string to minutes since midnight
   */
  private static timeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Helper: Convert minutes since midnight to "HH:MM"
   */
  private static minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  /**
   * Generates discrete slots for a doctor on a specific date (YYYY-MM-DD)
   */
  static async getDoctorSlotsForDate(
    doctorId: string | Types.ObjectId,
    dateString: string // e.g. "2026-11-20"
  ): Promise<{ date: string; isHoliday: boolean; holidayReason?: string; slots: GeneratedSlot[] }> {
    // 1. Check for Doctor Vacation / Holiday
    const holiday = await Holiday.findOne({ doctorId, date: dateString });
    if (holiday) {
      return {
        date: dateString,
        isHoliday: true,
        holidayReason: holiday.reason || 'Doctor is out of office / on leave',
        slots: [],
      };
    }

    // 2. Determine Day of Week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    // Parse the date as UTC midnight
    const [year, month, day] = dateString.split('-').map(Number);
    const targetDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const dayOfWeek = targetDate.getUTCDay();

    // 3. Fetch Doctor's Availability configuration for this day
    const availability = await Availability.findOne({
      doctorId,
      dayOfWeek,
      isWorkingDay: true,
    });

    if (!availability) {
      return {
        date: dateString,
        isHoliday: false,
        slots: [], // Not a working day for the doctor
      };
    }

    const { startTime, endTime, slotDurationMinutes, breaks } = availability;
    const startMins = this.timeToMinutes(startTime);
    const endMins = this.timeToMinutes(endTime);

    // 4. Precompute Break Intervals in minutes
    const breakIntervals = breaks.map((b) => ({
      start: this.timeToMinutes(b.start),
      end: this.timeToMinutes(b.end),
      reason: b.reason || 'Break',
    }));

    // 5. Query active appointments for this doctor on this day
    const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

    const bookedAppointments = await Appointment.find({
      doctorId,
      slotStartTime: { $gte: dayStart, $lte: dayEnd },
      status: {
        $in: [
          AppointmentStatus.REQUESTED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.IN_PROGRESS,
        ],
      },
    }).select('slotStartTime slotEndTime');

    // Store booked start timestamps in a Set for O(1) lookup
    const bookedTimestamps = new Set(
      bookedAppointments.map((app) => app.slotStartTime.getTime())
    );

    // 6. Generate Candidate Slots
    const slots: GeneratedSlot[] = [];
    const now = new Date();

    for (let current = startMins; current + slotDurationMinutes <= endMins; current += slotDurationMinutes) {
      const slotStartMins = current;
      const slotEndMins = current + slotDurationMinutes;

      // Check if slot overlaps with any scheduled break
      const isBreak = breakIntervals.some(
        (b) => Math.max(slotStartMins, b.start) < Math.min(slotEndMins, b.end)
      );

      if (isBreak) {
        // Skip break intervals from available booking slots
        continue;
      }

      // Construct absolute UTC Date objects for this slot
      const slotStartTime = new Date(
        Date.UTC(year, month - 1, day, Math.floor(slotStartMins / 60), slotStartMins % 60, 0, 0)
      );
      const slotEndTime = new Date(
        Date.UTC(year, month - 1, day, Math.floor(slotEndMins / 60), slotEndMins % 60, 0, 0)
      );

      // Check if slot has already elapsed in the past
      if (slotStartTime.getTime() <= now.getTime()) {
        continue;
      }

      // Check if already booked
      const isBooked = bookedTimestamps.has(slotStartTime.getTime());

      slots.push({
        startTime: slotStartTime.toISOString(),
        endTime: slotEndTime.toISOString(),
        displayTime: `${this.minutesToTime(slotStartMins)} - ${this.minutesToTime(slotEndMins)}`,
        status: isBooked ? 'BOOKED' : 'AVAILABLE',
      });
    }

    return {
      date: dateString,
      isHoliday: false,
      slots,
    };
  }
}
