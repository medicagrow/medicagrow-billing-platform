/**
 * Verification of the practice health scoring model.
 *
 *   npx tsx scripts/test-tracker-scoring.ts
 */

import {
  calculateScores,
  deriveFields,
  weightsByScoreKey,
} from "../lib/tracker/scoring";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const near = (a: number | null, b: number, tolerance = 0.01) =>
  a !== null && Math.abs(a - b) < tolerance;

console.log("=== derived fields ===");
{
  const derived = deriveFields({
    totalPayments: 75000,
    totalAdjustments: 25000,
    totalCharges: 150000,
    eobDenialsReceived: 60,
    totalClaims: 1000,
    arAmount0to30: 40000,
    arAmount31to60: 20000,
    arAmount61to90: 10000,
    arAmount90plus: 30000,
    totalAppointmentsForElig: 200,
    eligibilityCompleted: 190,
  });

  // (payments + adjustments) / charges = (75000 + 25000) / 150000
  check("net collection rate", near(derived.netCollectionRate, 2 / 3), String(derived.netCollectionRate));
  // payments / (payments + adjustments) = 75000 / 100000
  check("payment efficiency", near(derived.paymentEfficiency, 0.75), String(derived.paymentEfficiency));
  check("denial rate", near(derived.denialRate, 0.06), String(derived.denialRate));
  check("total AR", derived.totalAr === 100000, String(derived.totalAr));
  check("% AR over 90", near(derived.arPercentOver90, 0.3), String(derived.arPercentOver90));
  check("eligibility compliance", near(derived.eligibilityCompliance, 0.95), String(derived.eligibilityCompliance));
}

console.log("\n=== score bands ===");
{
  // Charges of 100 make the payments/adjustments pair read directly as a
  // percentage: (payments + adjustments) / 100.
  const scoreAFor = (payments: number, adjustments: number) =>
    calculateScores({
      totalPayments: payments,
      totalAdjustments: adjustments,
      totalCharges: 100,
    }).scoreA;

  check("A: 50% -> 40", scoreAFor(30, 20) === 40, String(scoreAFor(30, 20)));
  check("A: 65% -> 60", scoreAFor(40, 25) === 60, String(scoreAFor(40, 25)));
  check("A: 75% -> 80", scoreAFor(50, 25) === 80, String(scoreAFor(50, 25)));
  check("A: 90% -> 100", scoreAFor(70, 20) === 100, String(scoreAFor(70, 20)));
  check("A: exactly 80% -> 80 (bands are inclusive)", scoreAFor(60, 20) === 80, String(scoreAFor(60, 20)));
  check("A: just over 80% -> 100", scoreAFor(61, 20) === 100, String(scoreAFor(61, 20)));

  const scoreBFor = (pending: number) =>
    calculateScores({ pendingClaimsToBill: pending }).scoreB;

  check("B: 0 pending -> 100", scoreBFor(0) === 100, String(scoreBFor(0)));
  check("B: 3 pending -> 80", scoreBFor(3) === 80, String(scoreBFor(3)));
  check("B: 12 pending -> 60", scoreBFor(12) === 60, String(scoreBFor(12)));
  check("B: 50 pending -> 40", scoreBFor(50) === 40, String(scoreBFor(50)));

  // B takes the worst queue, not just claims.
  const worstQueue = calculateScores({
    pendingClaimsToBill: 0,
    pendingEraToPost: 50,
  }).scoreB;
  check("B: worst queue drives the score", worstQueue === 40, String(worstQueue));

  const scoreDFor = (over90: number, rest: number) =>
    calculateScores({ arAmount90plus: over90, arAmount0to30: rest }).scoreD;

  check("D: 5% over 90 -> 100", scoreDFor(5, 95) === 100, String(scoreDFor(5, 95)));
  check("D: 12% over 90 -> 80", scoreDFor(12, 88) === 80, String(scoreDFor(12, 88)));
  check("D: 20% over 90 -> 60", scoreDFor(20, 80) === 60, String(scoreDFor(20, 80)));
  check("D: 40% over 90 -> 40", scoreDFor(40, 60) === 40, String(scoreDFor(40, 60)));

  const scoreEFor = (compliance: number) =>
    calculateScores({ followUpCompliance: compliance }).scoreE;

  check("E: 95% -> 100", scoreEFor(0.95) === 100, String(scoreEFor(0.95)));
  check("E: 85% -> 80", scoreEFor(0.85) === 80, String(scoreEFor(0.85)));
  check("E: 70% -> 60", scoreEFor(0.7) === 60, String(scoreEFor(0.7)));
  check("E: 50% -> 40", scoreEFor(0.5) === 40, String(scoreEFor(0.5)));

  const scoreFFor = (completed: number, total: number) =>
    calculateScores({
      eligibilityCompleted: completed,
      totalAppointmentsForElig: total,
    }).scoreF;

  check("F: 98% -> 100", scoreFFor(98, 100) === 100, String(scoreFFor(98, 100)));
  check("F: 90% -> 80", scoreFFor(90, 100) === 80, String(scoreFFor(90, 100)));
  check("F: 75% -> 60", scoreFFor(75, 100) === 60, String(scoreFFor(75, 100)));
  check("F: 50% -> 40", scoreFFor(50, 100) === 40, String(scoreFFor(50, 100)));

  const scoreGFull = calculateScores({
    eftEnrollment: 1, eraEnrollment: 1, portalAccess: 1,
    feeSchedule: 0.95, sopCompliance: 0.95,
  }).scoreG;
  check("G: high average -> 100", scoreGFull === 100, String(scoreGFull));

  const scoreGLow = calculateScores({
    eftEnrollment: 0.5, eraEnrollment: 0.5, portalAccess: 0.5,
    feeSchedule: 0.5, sopCompliance: 0.5,
  }).scoreG;
  check("G: 50% average -> 40", scoreGLow === 40, String(scoreGLow));

  const scoreHBest = calculateScores({
    monthlyReviewMeeting: true,
    directClientCommunication: "Yes",
    resourcesAssigned: 2,
  }).scoreH;
  check("H: all good -> 100", scoreHBest === 100, String(scoreHBest));

  const scoreHMixed = calculateScores({
    monthlyReviewMeeting: false,
    directClientCommunication: "Partial",
    resourcesAssigned: 1,
  }).scoreH;
  // (0 + 30 + 60) / 3 = 30
  check("H: mixed -> 30", scoreHMixed === 30, String(scoreHMixed));
}

console.log("\n=== score C combines two measures ===");
{
  const both = calculateScores({
    eobDenialsReceived: 30, totalClaims: 1000,   // 3% -> 100
    outstandingRejections: 5, outstandingEobDenials: 0, // 5 total -> 80
  }).scoreC;
  check("C: average of 100 and 80 -> 90", both === 90, String(both));

  const denialOnly = calculateScores({
    eobDenialsReceived: 30, totalClaims: 1000,
  }).scoreC;
  check("C: denial rate alone -> 100", denialOnly === 100, String(denialOnly));

  const outstandingOnly = calculateScores({
    outstandingRejections: 50,
  }).scoreC;
  check("C: outstanding alone -> 40", outstandingOnly === 40, String(outstandingOnly));
}

console.log("\n=== missing data is excluded, not zeroed ===");
{
  const empty = calculateScores({});
  check("no data -> every score null", empty.missingScores.length === 8, String(empty.missingScores.length));
  check("no data -> final score null", empty.finalScore === null, String(empty.finalScore));

  // Only A available: it should carry the whole weight and equal itself.
  const onlyA = calculateScores({
    totalPayments: 90,
    totalAdjustments: 10,
    totalCharges: 100,
  });
  check("single score -> final equals it", onlyA.finalScore === 100, String(onlyA.finalScore));
  check("single score carries full weight", near(onlyA.effectiveWeights.scoreA ?? 0, 1), String(onlyA.effectiveWeights.scoreA));
  check("other seven reported missing", onlyA.missingScores.length === 7, String(onlyA.missingScores.length));

  // A (100, w .20) and E (40, w .20) -> equal halves -> 70.
  const twoScores = calculateScores({
    totalPayments: 90, totalAdjustments: 10, totalCharges: 100,
    followUpCompliance: 0.5,
  });
  check("two equal weights -> midpoint", twoScores.finalScore === 70, String(twoScores.finalScore));
  check("weights redistributed to 0.5 each", near(twoScores.effectiveWeights.scoreA ?? 0, 0.5), String(twoScores.effectiveWeights.scoreA));

  // A (100, w .20) and F (40, w .05) -> weights .8 / .2 -> 88.
  const unequal = calculateScores({
    totalPayments: 90, totalAdjustments: 10, totalCharges: 100,
    eligibilityCompleted: 50, totalAppointmentsForElig: 100,
  });
  check("unequal weights redistribute proportionally", unequal.finalScore === 88, String(unequal.finalScore));
}

console.log("\n=== a fully populated month ===");
{
  const result = calculateScores({
    totalPayments: 85000, totalAdjustments: 15000, totalCharges: 160000,
    pendingClaimsToBill: 2, pendingEraToPost: 1, pendingPatientPaymentsToPost: 0,
    rejectionsReceived: 20, outstandingRejections: 3,
    eobDenialsReceived: 40, outstandingEobDenials: 4, totalClaims: 1000,
    arAmount0to30: 50000, arAmount31to60: 20000,
    arAmount61to90: 15000, arAmount90plus: 15000,
    followUpCompliance: 0.92,
    totalAppointmentsForElig: 300, eligibilityCompleted: 291,
    eftEnrollment: 1, eraEnrollment: 1, portalAccess: 0.9,
    feeSchedule: 0.85, sopCompliance: 0.95,
    resourcesAssigned: 2, monthlyReviewMeeting: true,
    directClientCommunication: "Yes",
  });

  check("all eight scores computed", result.missingScores.length === 0, result.missingScores.join(", "));
  check("weights sum to 1", near(Object.values(result.effectiveWeights).reduce((a, b) => a + b, 0), 1), String(Object.values(result.effectiveWeights).reduce((a, b) => a + b, 0)));
  check("final score in range", result.finalScore !== null && result.finalScore >= 0 && result.finalScore <= 100, String(result.finalScore));
  console.log(`      A=${result.scoreA} B=${result.scoreB} C=${result.scoreC} D=${result.scoreD} E=${result.scoreE} F=${result.scoreF} G=${result.scoreG} H=${result.scoreH} final=${result.finalScore}`);
}

console.log("\n=== weights are the documented ones ===");
{
  const SCORE_WEIGHTS = weightsByScoreKey();
  const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  check("weights total 100%", near(total, 1), String(total));
  check("A weighted 20%", near(SCORE_WEIGHTS.scoreA, 0.2));
  check("D weighted 20%", near(SCORE_WEIGHTS.scoreD, 0.2));
  check("E weighted 20%", near(SCORE_WEIGHTS.scoreE, 0.2));
  check("C weighted 15%", near(SCORE_WEIGHTS.scoreC, 0.15));
  check("B weighted 10%", near(SCORE_WEIGHTS.scoreB, 0.1));
}

console.log("\n=== edge cases ===");
{
  const zeroAr = calculateScores({
    arAmount0to30: 0, arAmount31to60: 0, arAmount61to90: 0, arAmount90plus: 0,
  });
  check("zero AR does not divide by zero", zeroAr.scoreD === 100, String(zeroAr.scoreD));

  const zeroDenominator = calculateScores({ totalPayments: 0, totalAdjustments: 0 });
  check("zero payments and adjustments -> A null", zeroDenominator.scoreA === null, String(zeroDenominator.scoreA));

  const partialAr = calculateScores({ arAmount90plus: 10 });
  check("single AR bucket still scores", partialAr.scoreD === 40, String(partialAr.scoreD));
}

console.log("\n=== manual overrides ===");
{
  const calculated = calculateScores({
    totalPayments: 30,
    totalAdjustments: 20,
    totalCharges: 100,
  });

  check("calculated A is 40", calculated.scoreA === 40, String(calculated.scoreA));
  check("not flagged as overridden", calculated.netCollectionRateOverridden === false);

  const overridden = calculateScores({
    totalPayments: 30,
    totalAdjustments: 20,
    totalCharges: 100,
    netCollectionRateManual: 0.95,
  });

  check("override drives score A", overridden.scoreA === 100, String(overridden.scoreA));
  check("override is flagged", overridden.netCollectionRateOverridden === true);
  check(
    "calculated rate is still reported",
    near(overridden.netCollectionRate, 0.5),
    String(overridden.netCollectionRate),
  );
  check(
    "effective rate is the override",
    near(overridden.effectiveNetCollectionRate, 0.95),
    String(overridden.effectiveNetCollectionRate),
  );

  const efficiency = calculateScores({
    totalPayments: 30,
    totalAdjustments: 20,
    paymentEfficiencyManual: 0.9,
  });

  check(
    "payment efficiency override applies",
    near(efficiency.effectivePaymentEfficiency, 0.9),
    String(efficiency.effectivePaymentEfficiency),
  );
}

console.log(`\n${"=".repeat(60)}`);
console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
console.log("=".repeat(60));
process.exit(fail === 0 ? 0 : 1);
