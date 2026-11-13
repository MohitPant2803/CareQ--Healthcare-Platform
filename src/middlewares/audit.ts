import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AuditLog, AuditAction } from '../models/AuditLog.js';

export const auditAccess = (resource: string, action: AuditAction) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Capture response completion to log outcome
    res.on('finish', async () => {
      try {
        const isSuccess = res.statusCode >= 200 && res.statusCode < 400;
        const resourceId = (req.params.id || req.params.patientId || req.params.appointmentId) as string;
        const patientId = req.params.patientId || (req as any).patient?._id;

        await AuditLog.create({
          userId: req.user ? new Types.ObjectId(req.user.id) : undefined,
          userRole: req.user?.role,
          userEmail: req.user?.email,
          action: isSuccess ? action : AuditAction.ACCESS_DENIED,
          resource,
          resourceId,
          patientId: patientId ? new Types.ObjectId(patientId) : undefined,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.get('user-agent'),
          status: isSuccess ? 'SUCCESS' : 'FAILURE',
          reason: isSuccess ? undefined : `HTTP Status ${res.statusCode}`,
        });
      } catch (err) {
        // Non-blocking: audit log errors must not crash user response, but should be logged to stderr
        console.error('[AUDIT LOGGING FAILURE]:', err);
      }
    });

    next();
  };
};
