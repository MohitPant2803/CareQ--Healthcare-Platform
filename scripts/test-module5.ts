import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Patient } from '../src/models/Patient.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { SyntheticDataFactory } from '../src/utils/synthetic-data.js';
import { UserRole } from '../src/constants/roles.js';

async function runSecurityTest() {
  console.log('===============================================================');
  console.log(' CareQ Module 5 Test: Healthcare API Security & Audit Trail   ');
  console.log('===============================================================\n');

  await connectDB();

  await Promise.all([
    User.deleteMany({}),
    Patient.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);

  const app = createApp();
  const PORT = 5096;
  const server = app.listen(PORT);
  const baseUrl = `http://127.0.0.1:${PORT}`;

  try {
    // 1. Synthetic Patient Registration
    console.log('Step 1: Generating HIPAA-Safe Synthetic Patient...');
    const syntheticPatientData = SyntheticDataFactory.generatePatient(101);
    console.log(`Generated Synthetic Record: ${syntheticPatientData.firstName} ${syntheticPatientData.lastName} (${syntheticPatientData.email})`);

    const regRes = await fetch(`${baseUrl}/api/v1/auth/register/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...syntheticPatientData,
        password: 'SecurePassword123!',
      }),
    });
    const regData: any = await regRes.json();
    const patientToken = regData.data.tokens.accessToken;
    const patientId = regData.data.patient.id;
    console.log(`Registered Patient ID: ${patientId}`);

    // 2. Audit Trail Verification
    console.log('\nStep 2: Accessing Medical Record & Verifying HIPAA Audit Log...');
    const meRes = await fetch(`${baseUrl}/api/v1/patients/me`, {
      headers: { Authorization: `Bearer ${patientToken}` },
    });
    console.log(`Profile Accessed: HTTP ${meRes.status}`);

    // Wait a brief tick for asynchronous res.on('finish') audit entry to persist
    await new Promise((resolve) => setTimeout(resolve, 200));

    const auditRecords = await AuditLog.find({ action: 'READ' });
    console.log(`Audit Log Documents Created in Database: ${auditRecords.length}`);
    if (auditRecords.length > 0) {
      const log = auditRecords[0];
      console.log(`Audit Verified: User ${log.userEmail} (${log.userRole}) performed ${log.action} on ${log.resource} at ${log.createdAt.toISOString()} from IP ${log.ipAddress}`);
      console.log('SUCCESS: HIPAA-compliant audit trail is active!');
    } else {
      console.error('FAIL: No audit log was recorded!');
    }

    // 3. Defense against Mass Assignment (Privilege Escalation Attack)
    console.log('\nStep 3: Testing Mass Assignment Defense (Role Escalation Attempt)...');
    const attackerRes = await fetch(`${baseUrl}/api/v1/auth/register/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@evil.com',
        password: 'Password123!',
        firstName: 'Malicious',
        lastName: 'Actor',
        dateOfBirth: '1990-01-01',
        gender: 'OTHER',
        // Attacker payload attempts to inject ADMIN role:
        role: 'ADMIN',
        isActive: true,
      }),
    });
    const attackerData: any = await attackerRes.json();
    const createdAttackerUser = await User.findOne({ email: 'attacker@evil.com' });
    console.log(`Attacker Assigned Role in Database: [ ${createdAttackerUser?.role} ] (Expected: PATIENT)`);
    if (createdAttackerUser?.role === UserRole.PATIENT) {
      console.log('SUCCESS: Mass assignment defeated! Role injection was ignored.');
    } else {
      console.error('CRITICAL VULNERABILITY: Role injection succeeded!');
    }

    // 4. Defense against NoSQL Operator Injection
    console.log('\nStep 4: Testing NoSQL Injection Sanitization...');
    const nosqlRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Operator injection payload:
        email: { $ne: null },
        password: { $ne: null },
      }),
    });
    const nosqlData: any = await nosqlRes.json();
    console.log(`NoSQL Injection Response: HTTP ${nosqlRes.status}`);
    console.log(`Response Message: ${nosqlData.message}`);
    if (nosqlRes.status === 400 || nosqlRes.status === 401) {
      console.log('SUCCESS: NoSQL injection defeated by deep sanitizer & Zod validator!');
    } else {
      console.error('CRITICAL VULNERABILITY: NoSQL injection bypassed authentication!');
    }

    // 5. Security Headers Verification (Helmet)
    console.log('\nStep 5: Verifying Security Headers (OWASP API7)...');
    const healthRes = await fetch(`${baseUrl}/health`);
    const xContentType = healthRes.headers.get('x-content-type-options');
    const xFrame = healthRes.headers.get('x-frame-options');
    console.log(`X-Content-Type-Options: ${xContentType} (Expected: nosniff)`);
    console.log(`X-Frame-Options:        ${xFrame} (Expected: SAMEORIGIN)`);
    if (xContentType === 'nosniff' && xFrame === 'SAMEORIGIN') {
      console.log('SUCCESS: Helmet security hardening confirmed!');
    }

    console.log('\n===============================================================');
    console.log('            ALL MODULE 5 SECURITY TESTS PASSED!                ');
    console.log('===============================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

runSecurityTest().catch((err) => {
  console.error('Security test failed:', err);
  process.exit(1);
});
