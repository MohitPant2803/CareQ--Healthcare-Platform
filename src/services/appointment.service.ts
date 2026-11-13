import mongoose, { Types } from 'mongoose';
import { Appointment, IAppointment } from '../models/Appointment.js';
import {
  AppointmentStatus,
  ALLOWED_STATUS_TRANSITIONS,
  ROLE_TRANSITION_PERMISSIONS,
} from '../constants/appointment-status.js';
import { Doctor } from '../models/Doctor.js';
import { Patient } from '../models/Patient.js';
import { UserRole } from '../constants/roles.js';

export interface BookAppointmentInput {
  doctorId: string;
  patientId: string;
  slotStartTime: string; // ISO UTC string
  slotEndTime?: string;  // Optional, can be derived from doctor.appointmentDurationMinutes
  bookedBy: string;      // User ID of caller (patient or receptionist)
  reasonForVisit?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface ActorInfo {
  id: string;
  role: UserRole;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  cursor?: string; // For cursor-based pagination (last seen _id)
  doctorId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  startDate?: string;
  endDate?: string;
}

export class AppointmentService {
  /**
   * Concurrency-Safe Booking Engine:
   * Uses Database-Level Unique Compound Index + ACID Transactions.
   * Prevents double booking even under high concurrency.
   */
  static async bookAppointment(input: BookAppointmentInput): Promise<IAppointment> {
    const { doctorId, patientId, slotStartTime, bookedBy, reasonForVisit, notes, idempotencyKey } = input;
    const startTimeDate = new Date(slotStartTime);

    // 1. Check Idempotency Key first (if provided)
    if (idempotencyKey) {
      const existing = await Appointment.findOne({ idempotencyKey });
      if (existing) {
        return existing; // Return previously created appointment idempotently
      }
    }

    // 2. Fetch Doctor to get slot duration
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      const err: any = new Error('Doctor not found');
      err.statusCode = 404;
      throw err;
    }

    const durationMs = doctor.appointmentDurationMinutes * 60 * 1000;
    const endTimeDate = input.slotEndTime ? new Date(input.slotEndTime) : new Date(startTimeDate.getTime() + durationMs);

    // 3. Execute Booking inside a Transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const appointment = new Appointment({
        doctorId,
        patientId,
        slotStartTime: startTimeDate,
        slotEndTime: endTimeDate,
        status: AppointmentStatus.CONFIRMED,
        bookedBy,
        reasonForVisit,
        notes,
        idempotencyKey,
      });

      await appointment.save({ session });
      await session.commitTransaction();

      return appointment;
    } catch (err: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // Check for MongoDB Unique Index Constraint Violation (Code 11000)
      if (err.code === 11000 || (err.errorResponse && err.errorResponse.code === 11000)) {
        const conflictErr: any = new Error(
          'Booking conflict: This appointment slot was just booked by another patient. Please choose an alternative slot.'
        );
        conflictErr.statusCode = 409; // HTTP 409 Conflict
        throw conflictErr;
      }

      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Finite State Machine (FSM) Transition Engine:
   * Validates state graph transitions and role-based permissions.
   */
  static async transitionStatus(
    appointmentId: string,
    targetStatus: AppointmentStatus,
    actor: ActorInfo,
    metadata?: { cancellationReason?: string; notes?: string }
  ): Promise<IAppointment> {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      const err: any = new Error('Appointment not found');
      err.statusCode = 404;
      throw err;
    }

    const currentStatus = appointment.status;

    // 1. Validate State Machine Graph Transition
    const allowedTargets = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTargets.includes(targetStatus)) {
      const err: any = new Error(
        `Invalid state transition: Cannot change appointment status from '${currentStatus}' to '${targetStatus}'.`
      );
      err.statusCode = 400;
      throw err;
    }

    // 2. Validate Role-Based Transition Permissions
    const permittedRoles = ROLE_TRANSITION_PERMISSIONS[targetStatus] || [];
    if (!permittedRoles.includes(actor.role)) {
      const err: any = new Error(
        `Forbidden: Role '${actor.role}' is not authorized to transition appointment to '${targetStatus}'.`
      );
      err.statusCode = 403;
      throw err;
    }

    // 3. Resource Ownership Guard for Patients
    if (actor.role === UserRole.PATIENT) {
      const patient = await Patient.findOne({ userId: actor.id });
      if (!patient || appointment.patientId.toString() !== patient._id.toString()) {
        const err: any = new Error('Forbidden: You can only update your own appointment.');
        err.statusCode = 403;
        throw err;
      }

      // Patients cannot cancel appointments in the past
      if (targetStatus === AppointmentStatus.CANCELLED && appointment.slotStartTime.getTime() <= Date.now()) {
        const err: any = new Error('Cannot cancel an appointment that has already started or passed.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 4. Apply State Transition
    appointment.status = targetStatus;

    if (targetStatus === AppointmentStatus.CANCELLED) {
      appointment.cancelledAt = new Date();
      appointment.cancelledBy = new Types.ObjectId(actor.id);
      if (metadata?.cancellationReason) {
        appointment.cancellationReason = metadata.cancellationReason;
      }
    }

    if (metadata?.notes) {
      appointment.notes = metadata.notes;
    }

    await appointment.save();
    return appointment;
  }

  /**
   * Atomic Rescheduling Engine:
   * Transfers an active appointment to a new slot in an ACID transaction.
   * The Unique Partial Index ensures the new slot is not claimed concurrently.
   */
  static async rescheduleAppointment(
    appointmentId: string,
    newSlotStartTime: string,
    actor: ActorInfo
  ): Promise<IAppointment> {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      const err: any = new Error('Appointment not found');
      err.statusCode = 404;
      throw err;
    }

    // Rescheduling is only permitted for REQUESTED or CONFIRMED appointments
    if (
      appointment.status !== AppointmentStatus.REQUESTED &&
      appointment.status !== AppointmentStatus.CONFIRMED
    ) {
      const err: any = new Error(
        `Cannot reschedule an appointment in '${appointment.status}' state. Only REQUESTED or CONFIRMED appointments can be rescheduled.`
      );
      err.statusCode = 400;
      throw err;
    }

    // Ownership check for patients
    if (actor.role === UserRole.PATIENT) {
      const patient = await Patient.findOne({ userId: actor.id });
      if (!patient || appointment.patientId.toString() !== patient._id.toString()) {
        const err: any = new Error('Forbidden: You can only reschedule your own appointment.');
        err.statusCode = 403;
        throw err;
      }
    }

    const doctor = await Doctor.findById(appointment.doctorId);
    if (!doctor) {
      const err: any = new Error('Doctor not found');
      err.statusCode = 404;
      throw err;
    }

    const newStartTime = new Date(newSlotStartTime);
    if (newStartTime.getTime() <= Date.now()) {
      const err: any = new Error('Cannot reschedule to a past time slot.');
      err.statusCode = 400;
      throw err;
    }

    const durationMs = doctor.appointmentDurationMinutes * 60 * 1000;
    const newEndTime = new Date(newStartTime.getTime() + durationMs);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Record historical slot in audit trail
      appointment.rescheduleHistory.push({
        previousSlotStartTime: appointment.slotStartTime,
        previousSlotEndTime: appointment.slotEndTime,
        rescheduledAt: new Date(),
        rescheduledBy: new Types.ObjectId(actor.id),
      });

      // Update to new slot
      appointment.slotStartTime = newStartTime;
      appointment.slotEndTime = newEndTime;

      await appointment.save({ session });
      await session.commitTransaction();

      return appointment;
    } catch (err: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // If new slot is already booked, unique index throws 11000
      if (err.code === 11000 || (err.errorResponse && err.errorResponse.code === 11000)) {
        const conflictErr: any = new Error(
          'Reschedule conflict: The requested new time slot is already booked. Please select another slot.'
        );
        conflictErr.statusCode = 409;
        throw conflictErr;
      }

      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * High-Performance Pagination & Filtering:
   * Supports both Offset-Based Pagination and Cursor-Based Pagination.
   */
  static async getAppointments(params: PaginationQuery) {
    const {
      page = 1,
      limit = 10,
      cursor,
      doctorId,
      patientId,
      status,
      startDate,
      endDate,
    } = params;

    const filter: any = {};

    if (doctorId) filter.doctorId = doctorId;
    if (patientId) filter.patientId = patientId;
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.slotStartTime = {};
      if (startDate) filter.slotStartTime.$gte = new Date(startDate);
      if (endDate) filter.slotStartTime.$lte = new Date(endDate);
    }

    // 1. Cursor-Based Pagination (O(1) B-Tree seek for infinite scroll / high throughput)
    if (cursor) {
      filter._id = { $lt: new Types.ObjectId(cursor) };

      const items = await Appointment.find(filter)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .populate('doctorId', 'firstName lastName specialization department')
        .populate('patientId', 'firstName lastName gender dateOfBirth');

      const hasNextPage = items.length > limit;
      if (hasNextPage) items.pop();

      const nextCursor = hasNextPage && items.length > 0 ? items[items.length - 1]._id : null;

      return {
        mode: 'cursor',
        data: items,
        pagination: {
          limit,
          hasNextPage,
          nextCursor,
        },
      };
    }

    // 2. Offset-Based Pagination (for numbered UI tables: page 1, 2, 3...)
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      Appointment.find(filter)
        .sort({ slotStartTime: -1 })
        .skip(skip)
        .limit(safeLimit)
        .populate('doctorId', 'firstName lastName specialization department')
        .populate('patientId', 'firstName lastName gender dateOfBirth'),
      Appointment.countDocuments(filter),
    ]);

    return {
      mode: 'offset',
      data: items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
        hasNextPage: safePage * safeLimit < total,
      },
    };
  }
}
