import { UserRole } from './roles.js';

export enum AppointmentStatus {
  REQUESTED = 'REQUESTED',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

// Valid state machine transitions
export const ALLOWED_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  [AppointmentStatus.REQUESTED]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.CHECKED_IN]: [
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.IN_PROGRESS]: [
    AppointmentStatus.COMPLETED,
  ],
  [AppointmentStatus.COMPLETED]: [], // Terminal state
  [AppointmentStatus.CANCELLED]: [], // Terminal state
  [AppointmentStatus.NO_SHOW]: [],   // Terminal state
};

// Role-Based Transition Permissions
export const ROLE_TRANSITION_PERMISSIONS: Record<AppointmentStatus, UserRole[]> = {
  [AppointmentStatus.REQUESTED]: [UserRole.PATIENT, UserRole.RECEPTIONIST, UserRole.ADMIN],
  [AppointmentStatus.CONFIRMED]: [UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.ADMIN],
  [AppointmentStatus.CHECKED_IN]: [UserRole.RECEPTIONIST, UserRole.ADMIN, UserRole.PATIENT],
  [AppointmentStatus.IN_PROGRESS]: [UserRole.DOCTOR, UserRole.ADMIN],
  [AppointmentStatus.COMPLETED]: [UserRole.DOCTOR, UserRole.ADMIN],
  [AppointmentStatus.CANCELLED]: [UserRole.PATIENT, UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.ADMIN],
  [AppointmentStatus.NO_SHOW]: [UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.ADMIN],
};
