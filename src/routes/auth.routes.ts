import { Router } from 'express';
import {
  AuthController,
  registerPatientSchema,
  registerDoctorSchema,
  loginSchema,
  refreshTokenSchema,
} from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.post('/register/patient', validate(registerPatientSchema), AuthController.registerPatient);
router.post('/register/doctor', validate(registerDoctorSchema), AuthController.registerDoctor);
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/refresh', validate(refreshTokenSchema), AuthController.refreshToken);
router.post('/logout', authenticate, AuthController.logout);

export default router;
