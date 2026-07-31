// test-cases.js
//
// Runs the rules engine against the 5 case studies you already built by
// hand today. This is the cheapest possible test: no server, no browser,
// just a function call and printed output you can eyeball against what
// you already know is correct.
//
// Run with: node test-cases.js

const { computePlan } = require("./computePlan");

const cases = {
  "Cabelson Outdoor Co.": {
    catalogSize: 400,
    priceLow: 15,
    priceHigh: 2500,
    monthlyBudget: 15000,
    hasStore: "yes",
    brandRecognition: "yes",
    hasHistory: "yes",
    catalogChanged: "no",
    monthlyConversions: 40, // not pinned in the original case study, reasonable stand-in
    isSubscription: "no",
    isVisualLifestyle: "yes", // doc: "Lifestyle/outdoor category suits storytelling"
  },
  "PetBox Monthly": {
    catalogSize: 2, // Dog Box + Cat Box — below the Shopping SKU floor
    priceLow: 35,
    priceHigh: 35,
    monthlyBudget: 800,
    hasStore: "no",
    brandRecognition: "no",
    hasHistory: "no",
    isSubscription: "yes",
    retentionMonths: 5,
    isVisualLifestyle: "yes", // pet unboxing/lifestyle content; moot — budget floor excludes Video anyway
  },
  "Solstice Jewelry": {
    catalogSize: 80,
    priceLow: 25,
    priceHigh: 450,
    monthlyBudget: 6000,
    hasStore: "no",
    brandRecognition: "yes", // real, but from social — zero Google history
    hasHistory: "no",
    isSubscription: "no",
    isVisualLifestyle: "yes", // doc: "visual/lifestyle product category", TikTok-native
  },
  "Ember & Oak Candle Co.": {
    catalogSize: 15,
    priceLow: 18,
    priceHigh: 24,
    monthlyBudget: 350,
    hasStore: "no",
    brandRecognition: "no",
    hasHistory: "no",
    isSubscription: "no",
    isVisualLifestyle: "yes", // home-ambiance/gifting category; moot — budget floor excludes Video anyway
  },
  "Nordic Home Co.": {
    catalogSize: 60,
    priceLow: 80,
    priceHigh: 1200,
    monthlyBudget: 8000,
    hasStore: "no",
    brandRecognition: "yes", // residual, tied to the OLD catalog
    hasHistory: "yes",
    catalogChanged: "yes", // the pivot — this is what should make history unusable
    isSubscription: "no",
    isVisualLifestyle: "yes", // minimalist furniture/interior-design content; our inference, doc doesn't state this explicitly
  },
};

for (const [name, answers] of Object.entries(cases)) {
  console.log("\n==============================");
  console.log(name);
  console.log("==============================");
  const plan = computePlan(answers);

  let total = 0;
  plan.campaigns.forEach((c) => {
    total += c.amount;
    console.log(`\n${c.label}  —  $${c.amount.toLocaleString()} (${c.pctDisplay}%)`);
    console.log(`  Bidding: ${c.bidding.strategy}`);
    console.log(`  Why this allocation: ${c.allocation.reason}`);
    console.log(`  Why this bidding: ${c.bidding.reason}`);
    if (c.bidding.graduatesTo) {
      console.log(
        `  Graduates to "${c.bidding.graduatesTo}" once: ${c.bidding.graduationTrigger}`
      );
    } else {
      console.log(`  Graduation: ${c.bidding.graduationTrigger}`);
    }
    console.log(`  How long to observe: ${c.bidding.observationWindow}`);
  });

  console.log(`\nTOTAL ALLOCATED: $${total.toLocaleString()} (budget: $${plan.budget.toLocaleString()})`);
  if (plan.budget - total !== 0) {
    console.log(`  \u26a0 MISMATCH — off by $${plan.budget - total}`);
  }

  if (plan.warnings.length) {
    console.log("\nWarnings:");
    plan.warnings.forEach((w) => console.log("  - " + w));
  }
  if (plan.notes.length) {
    console.log("\nNotes:");
    plan.notes.forEach((n) => console.log("  - " + n));
  }
  if (plan.isSubscription && plan.estimatedLTV) {
    console.log(
      `\nSubscription flag: real value ~$${plan.estimatedLTV} (LTV), not the $${Math.round(
        plan.checkoutGuess
      )} checkout price.`
    );
  }
}
