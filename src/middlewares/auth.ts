import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.js';
import { UserRole } from '../constants/roles.js';
import { User } from '../models/User.js';

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, ENV.JWT_ACCESS_SECRET) as {
      userId: string;
      role: UserRole;
      email: string;
      iat: number;
    };

    // Verify user exists and has not changed password after token issuance
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'User account not found or disabled.' });
      return;
    }

    if (user.passwordChangedAt) {
      const changedTimestamp = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (decoded.iat < changedTimestamp) {
        res.status(401).json({
          success: false,
          message: 'Password was recently changed. Please login again.',
        });
        return;
      }
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
    };

    next();
  } catch (err: any) {
    res.status(401).json({ success: false, message: 'Invalid or expired access token' });
  }
};
