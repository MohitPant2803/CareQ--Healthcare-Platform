import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (err: any) {
      if (err instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: err.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }
      res.status(400).json({ success: false, message: 'Invalid payload' });
    }
  };
};
