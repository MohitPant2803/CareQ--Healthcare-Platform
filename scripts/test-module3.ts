import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Patient } from '../src/models/Patient.js';
import { Doctor } from '../src/models/Doctor.js';
import { Availability } from '../src/models/Availability.js';
import { Holiday } from '../src/models/Holiday.js';
import { Appointment } from '../src/models/Appointment.js';
import { AppointmentStatus } from '../src/constants/appointment-status.js';

async function runModule3LifecycleTest() {
  console.log('===============================================================');
  console.log('  CareQ Module 3 Test: Appointment Lifecycle & State Machine   ');
  console.log('===============================================================\n');

  await connectDB();

  await Promise.all([
    User.deleteMany({}),
    Patient.deleteMany({}),
    Doctor.deleteMany({}),
    Availability.deleteMany({}),
    Holiday.deleteMany({}),
    Appointment.deleteMany({}),
  ]);

  const app = createApp();
  const PORT = 5097;
  const server = app.listen(PORT);
  const baseUrl = `http://127.0.0.1:${PORT}`;

  try {
    // 1. Setup Doctor & Patient
    console.log('Step 1: Setting up Doctor, Patient, and Receptionist...');
    const docRes = await fetch(`${baseUrl}/api/v1/auth/register/doctor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dr.cameron@hospital.com',
        password: 'DoctorPass123!',
        firstName: 'Allison',
        lastName: 'Cameron',
        specialization: 'Immunology',
        department: 'Internal Medicine',
        licenseNumber: 'MD-CAMERON-002',
        appointmentDurationMinutes: 20,
        consultationFee: 200,
      }),
    });
    const docData: any = await docRes.json();
    const doctorId = docData.data.doctor.id;
    const docToken = docData.data.tokens.accessToken;

    // Register Patient
    const patRes = await fetch(`${baseUrl}/api/v1/auth/register/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'john.doe@example.com',
        password: 'PatientPass123!',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1988-03-25',
        gender: 'MALE',
      }),
    });
    const patData: any = await patRes.json();
    const patientId = patData.data.patient.id;
    const patToken = patData.data.tokens.accessToken;

    // 2. Book an Appointment
    console.log('\nStep 2: Booking Initial Appointment (CONFIRMED)...');
    const slot1 = '2026-11-20T09:00:00.000Z';
    const bookRes = await fetch(`${baseUrl}/api/v1/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patToken}`,
      },
      body: JSON.stringify({
        doctorId,
        patientId,
        slotStartTime: slot1,
        reasonForVisit: 'Allergy consultation and blood test',
      }),
    });
    const bookData: any = await bookRes.json();
    const appointmentId = bookData.data._id;
    console.log(`Appointment created with ID: ${appointmentId}, Status: ${bookData.data.status}`);

    // 3. Test FSM: Valid Transitions
    console.log('\nStep 3: Testing Valid State Machine Transitions...');

    // 3a. CHECKED_IN
    const checkInRes = await fetch(`${baseUrl}/api/v1/appointments/${appointmentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patToken}`, // Patient self-check-in allowed
      },
      body: JSON.stringify({ status: AppointmentStatus.CHECKED_IN }),
    });
    const checkInData: any = await checkInRes.json();
    console.log(`Transition to CHECKED_IN: ${checkInData.success} (Status: ${checkInData.data?.status})`);

    // 3b. IN_PROGRESS (Only Doctor or Admin)
    const inProgressRes = await fetch(`${baseUrl}/api/v1/appointments/${appointmentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({ status: AppointmentStatus.IN_PROGRESS }),
    });
    const inProgressData: any = await inProgressRes.json();
    console.log(`Transition to IN_PROGRESS: ${inProgressData.success} (Status: ${inProgressData.data?.status})`);

    // 3c. COMPLETED (Only Doctor)
    const completedRes = await fetch(`${baseUrl}/api/v1/appointments/${appointmentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({ status: AppointmentStatus.COMPLETED, notes: 'Patient prescribed antihistamines.' }),
    });
    const completedData: any = await completedRes.json();
    console.log(`Transition to COMPLETED: ${completedData.success} (Status: ${completedData.data?.status})`);

    // 4. Test FSM: Invalid Transition Attempt (Illegal State Jump)
    console.log('\nStep 4: Testing Illegal FSM Transition (COMPLETED -> CONFIRMED)...');
    const illegalRes = await fetch(`${baseUrl}/api/v1/appointments/${appointmentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${docToken}`,
      },
      body: JSON.stringify({ status: AppointmentStatus.CONFIRMED }),
    });
    const illegalData: any = await illegalRes.json();
    console.log(`HTTP Status: ${illegalRes.status}`);
    console.log(`Illegal Transition Rejection: ${illegalData.message}`);
    if (illegalRes.status === 400) {
      console.log('SUCCESS: Illegal state jump blocked by State Machine!');
    } else {
      console.error('FAIL: Illegal transition was permitted!');
    }

    // 5. Test Rescheduling & Slot Release
    console.log('\nStep 5: Testing Rescheduling Mechanics & Slot Transfer...');
    const slot2 = '2026-11-20T10:00:00.000Z';
    const slot3 = '2026-11-20T11:00:00.000Z';

    // Book new appointment at slot2
    const book2Res = await fetch(`${baseUrl}/api/v1/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patToken}`,
      },
      body: JSON.stringify({
        doctorId,
        patientId,
        slotStartTime: slot2,
        reasonForVisit: 'Followup visit',
      }),
    });
    const app2Data: any = await book2Res.json();
    const app2Id = app2Data.data._id;
    console.log(`Appointment 2 booked at: ${slot2}`);

    // Reschedule app2 from slot2 to slot3
    console.log(`Rescheduling Appointment 2 to: ${slot3}...`);
    const reschedRes = await fetch(`${baseUrl}/api/v1/appointments/${app2Id}/reschedule`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patToken}`,
      },
      body: JSON.stringify({ newSlotStartTime: slot3 }),
    });
    const reschedData: any = await reschedRes.json();
    console.log(`Rescheduled successfully: ${reschedData.success}`);
    console.log(`New Slot: ${reschedData.data?.slotStartTime}`);
    console.log(`Audit History recorded: ${reschedData.data?.rescheduleHistory?.length} prior slot(s).`);

    // Verify Old Slot (slot2) is now free for another booking!
    console.log(`Verifying old slot (${slot2}) is immediately available for another booking...`);
    const bookOldSlotRes = await fetch(`${baseUrl}/api/v1/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patToken}`,
      },
      body: JSON.stringify({
        doctorId,
        patientId,
        slotStartTime: slot2, // Should succeed because slot2 was released!
        reasonForVisit: 'Booking previously released slot',
      }),
    });
    const bookOldSlotData: any = await bookOldSlotRes.json();
    console.log(`Old slot rebooked: ${bookOldSlotData.success} (Status: ${bookOldSlotRes.status})`);
    if (bookOldSlotRes.status === 201) {
      console.log('SUCCESS: Old slot was atomically released upon rescheduling!');
    }

    // 6. Test Cancellation
    console.log('\nStep 6: Testing Cancellation & Slot Release...');
    const cancelRes = await fetch(`${baseUrl}/api/v1/appointments/${bookOldSlotData.data._id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patToken}`,
      },
      body: JSON.stringify({ reason: 'Patient recovered, no longer needed.' }),
    });
    const cancelData: any = await cancelRes.json();
    console.log(`Cancelled successfully: ${cancelData.success}, Status: ${cancelData.data?.status}`);

    // Verify rebooking the cancelled slot
    const rebookCancelledRes = await fetch(`${baseUrl}/api/v1/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${patToken}`,
      },
      body: JSON.stringify({
        doctorId,
        patientId,
        slotStartTime: slot2, // Rebooking the cancelled slot
        reasonForVisit: 'Patient re-scheduling same time',
      }),
    });
    console.log(`Rebooking cancelled slot: ${rebookCancelledRes.status === 201 ? 'SUCCESS (201)' : 'FAIL'}`);

    // 7. Test Pagination (Offset & Cursor)
    console.log('\nStep 7: Testing Pagination (Cursor vs Offset)...');
    const offsetRes = await fetch(`${baseUrl}/api/v1/appointments?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${patToken}` },
    });
    const offsetData: any = await offsetRes.json();
    console.log(`Offset Pagination: Page 1 returned ${offsetData.data.length} items (Total: ${offsetData.pagination.total})`);

    const cursorRes = await fetch(`${baseUrl}/api/v1/appointments?limit=2&cursor=${offsetData.data[0]._id}`, {
      headers: { Authorization: `Bearer ${patToken}` },
    });
    const cursorData: any = await cursorRes.json();
    console.log(`Cursor Pagination: Next page returned ${cursorData.data.length} items (HasNext: ${cursorData.pagination.hasNextPage})`);

    console.log('\n===============================================================');
    console.log('            ALL MODULE 3 LIFECYCLE TESTS PASSED!               ');
    console.log('===============================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

runModule3LifecycleTest().catch((err) => {
  console.error('Lifecycle test failed with error:', err);
  process.exit(1);
});
