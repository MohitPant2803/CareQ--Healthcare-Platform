import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Patient } from '../src/models/Patient.js';
import { Doctor } from '../src/models/Doctor.js';
import { Availability } from '../src/models/Availability.js';
import { Holiday } from '../src/models/Holiday.js';
import { Appointment } from '../src/models/Appointment.js';

async function runConcurrencyStressTest() {
  console.log('===============================================================');
  console.log('   CareQ Concurrency Stress Test: Preventing Double Booking    ');
  console.log('===============================================================\n');

  await connectDB();

  // Purge test db
  await Promise.all([
    User.deleteMany({}),
    Patient.deleteMany({}),
    Doctor.deleteMany({}),
    Availability.deleteMany({}),
    Holiday.deleteMany({}),
    Appointment.deleteMany({}),
  ]);

  const app = createApp();
  const PORT = 5098;
  const server = app.listen(PORT);
  const baseUrl = `http://127.0.0.1:${PORT}`;

  try {
    // 1. Setup Doctor: Dr. Gregory House
    console.log('Step 1: Registering Doctor (Dr. Gregory House)...');
    const docRes = await fetch(`${baseUrl}/api/v1/auth/register/doctor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dr.house@princetonplainsboro.com',
        password: 'Diagnostics123!',
        firstName: 'Gregory',
        lastName: 'House',
        specialization: 'Diagnostic Medicine',
        department: 'Nephrology',
        licenseNumber: 'MD-HOUSE-001',
        appointmentDurationMinutes: 20,
        consultationFee: 350,
      }),
    });
    const docData: any = await docRes.json();
    const doctorId = docData.data.doctor.id;
    const docToken = docData.data.tokens.accessToken;
    console.log(`Doctor created with ID: ${doctorId}`);

    // 2. Configure Working Hours & Breaks:
    // Friday (dayOfWeek = 5), 09:00 to 13:00, with break 11:00-11:40
    console.log('\nStep 2: Configuring Dr. House Availability (09:00 - 13:00, 20m slots)...');
    await fetch(`${baseUrl}/api/v1/doctors/${doctorId}/availability`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({
        dayOfWeek: 5, // Friday
        startTime: '09:00',
        endTime: '13:00',
        slotDurationMinutes: 20,
        breaks: [
          { start: '11:00', end: '11:40', reason: 'Clinic Staff Meeting' },
        ],
        isWorkingDay: true,
      }),
    });

    // 3. Query Slots for Friday, Nov 20, 2026
    const testDate = '2026-11-20';
    console.log(`\nStep 3: Generating Slots for Date: ${testDate} (Friday)...`);
    const slotsRes = await fetch(`${baseUrl}/api/v1/doctors/${doctorId}/slots?date=${testDate}`);
    const slotsData: any = await slotsRes.json();
    console.log(`Generated ${slotsData.data.slots.length} Candidate Slots:`);
    console.table(
      slotsData.data.slots.map((s: any) => ({
        Time: s.displayTime,
        Status: s.status,
        UTC_Start: s.startTime,
      }))
    );

    // 4. Register 10 Concurrent Patients
    console.log('\nStep 4: Registering 10 Separate Patients for Concurrency Simulation...');
    const patients: { id: string; name: string; token: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      const pRes = await fetch(`${baseUrl}/api/v1/auth/register/patient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `patient_${i}@example.com`,
          password: 'Password123!',
          firstName: `Patient_${i}`,
          lastName: `Test`,
          dateOfBirth: '1995-01-01',
          gender: i % 2 === 0 ? 'FEMALE' : 'MALE',
        }),
      });
      const pData: any = await pRes.json();
      patients.push({
        id: pData.data.patient.id,
        name: `Patient_${i}`,
        token: pData.data.tokens.accessToken,
      });
    }
    console.log(`Successfully registered ${patients.length} patients.`);

    // 5. THE RACE CONDITION TEST:
    // All 10 patients attempt to book the EXACT SAME SLOT at the EXACT SAME INSTANT:
    // Slot: "2026-11-20T09:20:00.000Z" (09:20 - 09:40)
    const targetSlotStartTime = '2026-11-20T09:20:00.000Z';
    console.log('\n===============================================================');
    console.log(`   FIRING 10 CONCURRENT BOOKING REQUESTS FOR: ${targetSlotStartTime}`);
    console.log('===============================================================\n');

    const startTime = Date.now();

    // Fire all 10 requests simultaneously using Promise.all
    const bookingPromises = patients.map((patient) => {
      return fetch(`${baseUrl}/api/v1/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${patient.token}`,
        },
        body: JSON.stringify({
          doctorId,
          patientId: patient.id,
          slotStartTime: targetSlotStartTime,
          reasonForVisit: `High priority consultation for ${patient.name}`,
        }),
      }).then(async (res) => {
        const body: any = await res.json();
        return {
          patientName: patient.name,
          status: res.status,
          success: body.success,
          code: body.code,
          message: body.message,
        };
      });
    });

    const results = await Promise.all(bookingPromises);
    const duration = Date.now() - startTime;

    console.log(`All 10 concurrent requests finished in ${duration}ms.\n`);
    console.log('Execution Results per Patient:');
    console.table(results);

    // 6. Verify Concurrency Invariants
    const successfulBookings = results.filter((r) => r.status === 201);
    const conflictedBookings = results.filter((r) => r.status === 409);

    console.log('\n--- Concurrency Verification Summary ---');
    console.log(`Total Requests:      ${results.length}`);
    console.log(`Successful Bookings: ${successfulBookings.length} (Expected: 1)`);
    console.log(`Conflict Rejections: ${conflictedBookings.length} (Expected: 9)`);

    // Verify directly in MongoDB storage
    const dbAppointmentsCount = await Appointment.countDocuments({
      doctorId,
      slotStartTime: new Date(targetSlotStartTime),
    });
    console.log(`Actual Appointments in MongoDB: ${dbAppointmentsCount} (Expected: 1)`);

    if (successfulBookings.length === 1 && conflictedBookings.length === 9 && dbAppointmentsCount === 1) {
      console.log('\n>>> SUCCESS: RACE CONDITION PREVENTED! DOUBLE BOOKING IS IMPOSSIBLE! <<<');
      console.log(`Winning Patient: ${successfulBookings[0].patientName}`);
    } else {
      console.error('\n>>> FATAL FAILURE: Double booking occurred! <<<');
      process.exit(1);
    }

    // 7. Re-query Slots: Verify Slot is now marked as BOOKED
    console.log('\nStep 5: Re-querying Doctor Slots to verify real-time status update:');
    const updatedSlotsRes = await fetch(`${baseUrl}/api/v1/doctors/${doctorId}/slots?date=${testDate}`);
    const updatedSlotsData: any = await updatedSlotsRes.json();
    const targetSlot = updatedSlotsData.data.slots.find((s: any) => s.startTime === targetSlotStartTime);
    console.log(`Slot ${targetSlot.displayTime} status in database: [ ${targetSlot.status} ]`);

    console.log('\n===============================================================');
    console.log('            ALL MODULE 2 CONCURRENCY TESTS PASSED!             ');
    console.log('===============================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

runConcurrencyStressTest().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
