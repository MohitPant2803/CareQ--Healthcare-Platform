import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../constants/roles.js';

export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Forbidden: Role '${req.user.role}' lacks permission to access this resource.`,
      });
      return;
    }

    next();
  };
};
