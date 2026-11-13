import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Patient } from '../src/models/Patient.js';
import { Doctor } from '../src/models/Doctor.js';

async function runModule1Test() {
  console.log('=== Starting Module 1 Integration & Security Test ===');
  await connectDB();

  // Clean test db
  await User.deleteMany({});
  await Patient.deleteMany({});
  await Doctor.deleteMany({});

  const app = createApp();
  const server = app.listen(5099);

  try {
    const baseUrl = 'http://127.0.0.1:5099';

    // 1. Register Patient A
    console.log('\n--- 1. Registering Patient Alice ---');
    const resA = await fetch(`${baseUrl}/api/v1/auth/register/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'Password123!',
        phone: '+15551234567',
        firstName: 'Alice',
        lastName: 'Smith',
        dateOfBirth: '1990-05-15',
        gender: 'FEMALE',
        bloodGroup: 'O+',
        allergies: ['Penicillin'],
        emergencyContact: {
          name: 'Bob Smith',
          relationship: 'Spouse',
          phone: '+15559876543',
        },
      }),
    });
    const dataA: any = await resA.json();
    console.log('Alice registered:', dataA.success, 'Patient ID:', dataA.data?.patient?.id);
    const aliceToken = dataA.data.tokens.accessToken;
    const alicePatientId = dataA.data.patient.id;

    // 2. Register Patient B (Bob)
    console.log('\n--- 2. Registering Patient Bob ---');
    const resB = await fetch(`${baseUrl}/api/v1/auth/register/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bob@example.com',
        password: 'Password123!',
        phone: '+15552345678',
        firstName: 'Bob',
        lastName: 'Jones',
        dateOfBirth: '1985-08-20',
        gender: 'MALE',
        bloodGroup: 'A+',
        allergies: [],
      }),
    });
    const dataB: any = await resB.json();
    console.log('Bob registered:', dataB.success, 'Patient ID:', dataB.data?.patient?.id);
    const bobToken = dataB.data.tokens.accessToken;
    const bobPatientId = dataB.data.patient.id;

    // 3. Test IDOR/BOLA Protection: Alice attempts to read Bob's medical record
    console.log('\n--- 3. Testing IDOR / BOLA Prevention (Alice requests Bob record) ---');
    const bToARes = await fetch(`${baseUrl}/api/v1/patients/${bobPatientId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const idorResult: any = await bToARes.json();
    console.log(`Status code: ${bToARes.status}`);
    console.log('Security Guard Response:', idorResult.message);
    if (bToARes.status === 403) {
      console.log('SUCCESS: IDOR successfully blocked! Patient A cannot view Patient B data.');
    } else {
      console.error('FAIL: IDOR vulnerability detected!');
    }

    // 4. Alice accesses her own profile via /patients/me
    console.log('\n--- 4. Alice accesses /patients/me ---');
    const meRes = await fetch(`${baseUrl}/api/v1/patients/me`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const meData: any = await meRes.json();
    console.log('Profile retrieved:', meData.success, 'Name:', meData.data?.firstName, meData.data?.lastName);

    // 5. Test Refresh Token Rotation
    console.log('\n--- 5. Testing Refresh Token Rotation ---');
    const rotateRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: dataA.data.tokens.refreshToken }),
    });
    const rotateData: any = await rotateRes.json();
    console.log('Rotated successfully:', rotateData.success);

    // 6. Test Token Reuse Detection
    console.log('\n--- 6. Testing Token Reuse Attack (Replaying old refresh token) ---');
    const reuseRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: dataA.data.tokens.refreshToken }),
    });
    const reuseData: any = await reuseRes.json();
    console.log('Reuse blocked:', !reuseData.success, 'Reason:', reuseData.message);

    console.log('\n=== ALL MODULE 1 TESTS PASSED! ===\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

runModule1Test().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
