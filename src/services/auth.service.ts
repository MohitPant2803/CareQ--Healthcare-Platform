import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ENV } from '../config/env.js';
import { UserRole } from '../constants/roles.js';
import { User, IUser } from '../models/User.js';

export interface TokenPayload {
  userId: string;
  role: UserRole;
  email: string;
}

export class AuthService {
  // Generate short-lived access token (15m)
  static generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, ENV.JWT_ACCESS_SECRET, {
      expiresIn: ENV.JWT_ACCESS_EXPIRES_IN as any,
    });
  }

  // Generate long-lived refresh token (7d)
  static generateRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload, ENV.JWT_REFRESH_SECRET, {
      expiresIn: ENV.JWT_REFRESH_EXPIRES_IN as any,
    });
  }

  // Hash refresh token for safe storage in database
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Issue tokens and save hashed refresh token in database (Session Management)
  static async issueTokenPair(user: IUser): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: TokenPayload = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    };

    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);
    const hashedRefreshToken = this.hashToken(refreshToken);

    // Keep at most 5 active sessions per user (token limit & hygiene)
    user.refreshTokens.push(hashedRefreshToken);
    if (user.refreshTokens.length > 5) {
      user.refreshTokens.shift();
    }
    await user.save();

    return { accessToken, refreshToken };
  }

  // Refresh Token Rotation (Detect reuse & revoke old token)
  static async rotateRefreshToken(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const decoded = jwt.verify(token, ENV.JWT_REFRESH_SECRET) as TokenPayload;
      const hashed = this.hashToken(token);

      const user = await User.findById(decoded.userId).select('+refreshTokens');
      if (!user || !user.isActive) {
        throw new Error('User not found or deactivated');
      }

      // Check if this refresh token is in the user's active token list
      const tokenIndex = user.refreshTokens.indexOf(hashed);
      if (tokenIndex === -1) {
        // TOKEN REUSE DETECTED! Invalidate all refresh tokens for this user immediately (Security defense)
        user.refreshTokens = [];
        await user.save();
        throw new Error('Detected compromised refresh token. All active sessions revoked.');
      }

      // Remove the old token (one-time use)
      user.refreshTokens.splice(tokenIndex, 1);

      // Issue new token pair
      return await this.issueTokenPair(user);
    } catch (err: any) {
      throw new Error(err.message || 'Invalid refresh token');
    }
  }

  // Logout - revoke refresh token
  static async revokeRefreshToken(userId: string, token: string): Promise<void> {
    const hashed = this.hashToken(token);
    await User.findByIdAndUpdate(userId, {
      $pull: { refreshTokens: hashed },
    });
  }
}
