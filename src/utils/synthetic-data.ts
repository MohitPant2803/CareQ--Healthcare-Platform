import crypto from 'crypto';

export interface SyntheticPatient {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  bloodGroup: string;
  allergies: string[];
  medicalNotes: string;
}

const FIRST_NAMES = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Sam', 'Chris', 'Pat'];
const LAST_NAMES = ['Avery', 'Bailey', 'Cameron', 'Dakota', 'Ellis', 'Finley', 'Harper', 'Kendall'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMMON_ALLERGIES = ['Penicillin', 'Peanuts', 'Latex', 'Sulfa drugs', 'Aspirin', 'Shellfish'];

export class SyntheticDataFactory {
  /**
   * Generates HIPAA-safe synthetic patient profiles for testing & dev
   */
  static generatePatient(index: number = 1): SyntheticPatient {
    const fn = FIRST_NAMES[index % FIRST_NAMES.length];
    const ln = LAST_NAMES[index % LAST_NAMES.length];
    const hash = crypto.randomBytes(3).toString('hex');

    return {
      firstName: fn,
      lastName: ln,
      email: `synthetic_${fn.toLowerCase()}_${hash}@careq-test.internal`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      dateOfBirth: '1992-06-14',
      gender: index % 2 === 0 ? 'FEMALE' : 'MALE',
      bloodGroup: BLOOD_GROUPS[index % BLOOD_GROUPS.length],
      allergies: [COMMON_ALLERGIES[index % COMMON_ALLERGIES.length]],
      medicalNotes: 'Synthetic medical record generated for security and concurrency benchmark.',
    };
  }
}
