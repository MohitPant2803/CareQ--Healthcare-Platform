import mongoose, { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Appointment } from '../src/models/Appointment.js';
import { AppointmentStatus } from '../src/constants/appointment-status.js';

async function runExplainBenchmark() {
  console.log('===============================================================');
  console.log(' CareQ Performance Benchmark: Query Plans & ESR Optimization  ');
  console.log('===============================================================\n');

  await connectDB();

  const collection = Appointment.collection;

  console.log('Step 1: Dropping all performance indexes to establish UNINDEXED baseline...');
  // Drop compound indexes if they exist (keep only _id)
  try {
    await collection.dropIndexes();
  } catch (err) {
    // ignore
  }

  console.log('Step 2: Seeding 20,000 realistic appointment documents...');
  const targetDoctorId = new Types.ObjectId();
  const otherDoctorIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
  const patientId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const appointmentsBatch: any[] = [];
  const baseTime = new Date('2026-11-01T08:00:00Z').getTime();

  // Create 2,000 appointments for our target doctor, and 18,000 for other doctors
  for (let i = 0; i < 20000; i++) {
    const isTarget = i < 2000;
    const docId = isTarget ? targetDoctorId : otherDoctorIds[i % otherDoctorIds.length];
    const slotStart = new Date(baseTime + (i % 500) * 20 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 20 * 60 * 1000);
    const statuses = [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.COMPLETED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.CHECKED_IN,
    ];

    appointmentsBatch.push({
      doctorId: docId,
      patientId,
      slotStartTime: slotStart,
      slotEndTime: slotEnd,
      status: statuses[i % statuses.length],
      bookedBy: userId,
      reasonForVisit: `Routine Consultation Checkup #${i}`,
      notes: 'Standard vitals normal.',
      rescheduleHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Insert in bulk chunks for speed
  const chunkSize = 5000;
  for (let i = 0; i < appointmentsBatch.length; i += chunkSize) {
    await collection.insertMany(appointmentsBatch.slice(i, i + chunkSize), { ordered: false });
  }
  console.log(`Successfully seeded ${await collection.countDocuments()} appointments.\n`);

  // Define our target realistic doctor schedule query:
  // "Find confirmed appointments for targetDoctor between Nov 1 and Nov 5, sorted chronologically"
  const rangeStart = new Date('2026-11-01T00:00:00Z');
  const rangeEnd = new Date('2026-11-05T23:59:59Z');

  const targetQuery = {
    doctorId: targetDoctorId, // Equality (E)
    status: AppointmentStatus.CONFIRMED, // Equality (E)
    slotStartTime: { $gte: rangeStart, $lte: rangeEnd }, // Range (R)
  };
  const targetSort: any = { slotStartTime: 1 }; // Sort (S)

  // ==============================================================
  // EXPERIMENT 1: UNINDEXED QUERY (Full Collection Scan - COLLSCAN)
  // ==============================================================
  console.log('---------------------------------------------------------------');
  console.log(' EXPERIMENT 1: Unindexed Query (Baseline COLLSCAN)');
  console.log('---------------------------------------------------------------');

  const startT1 = performance.now();
  const unindexedExplain: any = await Appointment.find(targetQuery)
    .sort(targetSort)
    .limit(20)
    .explain('executionStats');
  const elapsedT1 = performance.now() - startT1;

  const stats1 = unindexedExplain.executionStats;
  console.log(`Winning Stage:            ${stats1.executionStages.stage}`);
  console.log(`Execution Time (DB ms):   ${stats1.executionTimeMillis} ms`);
  console.log(`Total Docs Examined:      ${stats1.totalDocsExamined} (Entire collection scanned!)`);
  console.log(`Total Keys Examined:      ${stats1.totalKeysExamined}`);
  console.log(`Documents Returned:       ${stats1.nReturned}`);
  console.log(`In-Memory Sort Used?:     ${JSON.stringify(unindexedExplain.executionStages?.stage === 'SORT' || stats1.executionStages.inputStage?.stage === 'SORT')}`);
  console.log(`Total Latency (App + DB): ${elapsedT1.toFixed(2)} ms\n`);

  // ==============================================================
  // EXPERIMENT 2: NAIVE / SUBOPTIMAL INDEX (Range first: { slotStartTime: 1, doctorId: 1 })
  // ==============================================================
  console.log('---------------------------------------------------------------');
  console.log(' EXPERIMENT 2: Suboptimal Index (Range field first: { slotStartTime: 1, doctorId: 1 })');
  console.log('---------------------------------------------------------------');

  await collection.createIndex({ slotStartTime: 1, doctorId: 1 });

  const startT2 = performance.now();
  const suboptExplain: any = await Appointment.find(targetQuery)
    .sort(targetSort)
    .limit(20)
    .explain('executionStats');
  const elapsedT2 = performance.now() - startT2;

  const stats2 = suboptExplain.executionStats;
  console.log(`Winning Stage:            ${stats2.executionStages.stage}`);
  console.log(`Execution Time (DB ms):   ${stats2.executionTimeMillis} ms`);
  console.log(`Total Docs Examined:      ${stats2.totalDocsExamined}`);
  console.log(`Total Keys Examined:      ${stats2.totalKeysExamined}`);
  console.log(`Documents Returned:       ${stats2.nReturned}`);
  console.log(`Total Latency (App + DB): ${elapsedT2.toFixed(2)} ms\n`);

  await collection.dropIndex({ slotStartTime: 1, doctorId: 1 });

  // ==============================================================
  // EXPERIMENT 3: THE ESR OPTIMIZED COMPOUND INDEX
  // Rule: Equality (doctorId, status) -> Sort (slotStartTime) -> Range (slotStartTime)
  // Index: { doctorId: 1, status: 1, slotStartTime: 1 }
  // ==============================================================
  console.log('---------------------------------------------------------------');
  console.log(' EXPERIMENT 3: ESR-Optimized Compound Index { doctorId: 1, status: 1, slotStartTime: 1 }');
  console.log('---------------------------------------------------------------');

  await collection.createIndex({ doctorId: 1, status: 1, slotStartTime: 1 });

  const startT3 = performance.now();
  const esrExplain: any = await Appointment.find(targetQuery)
    .sort(targetSort)
    .limit(20)
    .explain('executionStats');
  const elapsedT3 = performance.now() - startT3;

  const stats3 = esrExplain.executionStats;
  console.log(`Winning Stage:            ${stats3.executionStages.stage}`);
  console.log(`Execution Time (DB ms):   ${stats3.executionTimeMillis} ms`);
  console.log(`Total Docs Examined:      ${stats3.totalDocsExamined}`);
  console.log(`Total Keys Examined:      ${stats3.totalKeysExamined}`);
  console.log(`Documents Returned:       ${stats3.nReturned}`);
  console.log(`Total Latency (App + DB): ${elapsedT3.toFixed(2)} ms\n`);

  // ==============================================================
  // EXPERIMENT 4: APPLICATION LAYER OPTIMIZATION (.lean() vs Mongoose Hydration)
  // ==============================================================
  console.log('---------------------------------------------------------------');
  console.log(' EXPERIMENT 4: Mongoose Hydration vs .lean() (CPU & RAM Optimization)');
  console.log('---------------------------------------------------------------');

  // Measure 100 queries with Mongoose Model hydration
  const iters = 50;
  const tHydratedStart = performance.now();
  for (let i = 0; i < iters; i++) {
    await Appointment.find(targetQuery).sort(targetSort).limit(20);
  }
  const hydratedAvg = (performance.now() - tHydratedStart) / iters;

  // Measure 100 queries with .lean()
  const tLeanStart = performance.now();
  for (let i = 0; i < iters; i++) {
    await Appointment.find(targetQuery).sort(targetSort).limit(20).lean();
  }
  const leanAvg = (performance.now() - tLeanStart) / iters;

  const latencyReduction = (((hydratedAvg - leanAvg) / hydratedAvg) * 100).toFixed(1);

  console.log(`Hydrated Mongoose Documents Avg Latency: ${hydratedAvg.toFixed(2)} ms`);
  console.log(`Lean Plain JS Objects (.lean()) Latency:  ${leanAvg.toFixed(2)} ms`);
  console.log(`Application CPU / Latency Reduction:     ${latencyReduction}% faster with .lean()!\n`);

  // ==============================================================
  // FINAL SUMMARY TABLE
  // ==============================================================
  console.log('===============================================================');
  console.log('                 PERFORMANCE BENCHMARK SUMMARY                 ');
  console.log('===============================================================');
  console.table([
    {
      Configuration: '1. No Index (COLLSCAN)',
      'DB Time (ms)': stats1.executionTimeMillis,
      'Docs Examined': stats1.totalDocsExamined,
      'Keys Examined': stats1.totalKeysExamined,
      'Efficiency Ratio': `${(stats1.totalDocsExamined / Math.max(1, stats1.nReturned)).toFixed(1)} : 1`,
    },
    {
      Configuration: '2. Suboptimal Range Index',
      'DB Time (ms)': stats2.executionTimeMillis,
      'Docs Examined': stats2.totalDocsExamined,
      'Keys Examined': stats2.totalKeysExamined,
      'Efficiency Ratio': `${(stats2.totalDocsExamined / Math.max(1, stats2.nReturned)).toFixed(1)} : 1`,
    },
    {
      Configuration: '3. ESR Compound Index (IXSCAN)',
      'DB Time (ms)': stats3.executionTimeMillis,
      'Docs Examined': stats3.totalDocsExamined,
      'Keys Examined': stats3.totalKeysExamined,
      'Efficiency Ratio': `${(stats3.totalDocsExamined / Math.max(1, stats3.nReturned)).toFixed(1)} : 1`,
    },
  ]);

  // Restore production indexes
  await Appointment.init();
  await disconnectDB();
}

runExplainBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
