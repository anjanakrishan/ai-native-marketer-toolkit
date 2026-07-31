// computePlan.js
//
// Rules engine for ecommerce Google Ads campaign structure, implementing the
// decision tree in ai-native-marketer/Logic/Campaign Structure for Ecommerce SMBs.md
// (Nodes 1-5). Given business inputs, returns:
//   - which campaigns to launch (Node 1-3)
//   - budget allocation + reasoning (Node 4)
//   - bidding strategy + reasoning (Node 5)
//   - how long to observe each campaign before graduating bidding strategy
//
// Industry-average anchors used below (CPA, CPC) come straight from the doc's
// own published ranges (Node 5 "the math" section) — swap in real observed
// numbers once campaigns have actual data.

const FLOOR = 450; // Node 5 math: ~$400-500/mo minimum to ever earn into automated bidding
const SHOPPING_MIN_VIABLE = 175; // below this, even concentrating into Shopping alone isn't worth it
const PMAX_CONVERSION_THRESHOLD = 30; // Node 1: PMax precondition
const PMAX_SKU_THRESHOLD = 50; // Node 1: PMax precondition
const PRICE_VARIANCE_RATIO = 5; // Node 3: high/low price ratio treated as "meaningful variance"
const MIN_EXPERIMENTAL_DOLLAR = 150; // below this, an experimental test budget isn't worth standing up
const EST_CPA = 35; // midpoint of the doc's $20-50 CPA range, used for observation-window math
const WEEKS_PER_MONTH = 4.345;

const GRADUATION_STEPS = [
  { conversions: 15, strategy: "Maximize Conversions" },
  { conversions: 30, strategy: "Target CPA" },
  { conversions: 50, strategy: "Target ROAS" },
];

function isYes(v) {
  return v === "yes" || v === true;
}

function round10(n) {
  return Math.round(n / 10) * 10;
}

function weeksToConversions(monthlyDollars, conversions) {
  if (!monthlyDollars || monthlyDollars <= 0) return null;
  const estMonthlyConversions = monthlyDollars / EST_CPA;
  if (estMonthlyConversions <= 0) return null;
  return (conversions / estMonthlyConversions) * WEEKS_PER_MONTH;
}

function fmtWeeks(weeks) {
  if (weeks === null) return "n/a";
  return `~${Math.max(1, Math.round(weeks))} wk${Math.round(weeks) === 1 ? "" : "s"}`;
}

// Builds the "how long should I observe this campaign" answer for
// manual/earn-in campaigns, walking the Maximize Conversions -> Target CPA ->
// Target ROAS ladder from whatever step it's starting at.
function observationWindowFor(monthlyDollars, startAtConversionFloor) {
  const steps = GRADUATION_STEPS.filter((s) => s.conversions > startAtConversionFloor);
  if (steps.length === 0) {
    return `Already past the data thresholds this menu tracks — monitor weekly and consider Target ROAS if not already there.`;
  }
  const parts = steps.map((s) => {
    const w = weeksToConversions(monthlyDollars, s.conversions);
    return `${fmtWeeks(w)} to ~${s.conversions} conversions/30 days (→ ${s.strategy})`;
  });
  return `${parts.join("; then ")} — assuming ~$${EST_CPA} est. CPA at this budget.`;
}

function computePlan(input) {
  const {
    catalogSize = 0,
    priceLow = 0,
    priceHigh = 0,
    monthlyBudget = 0,
    hasStore,
    brandRecognition,
    hasHistory,
    catalogChanged,
    monthlyConversions = 0,
    isSubscription,
    retentionMonths,
    isVisualLifestyle,
  } = input;

  const isSub = isYes(isSubscription);
  const store = isYes(hasStore);
  const brand = isYes(brandRecognition);
  const history = isYes(hasHistory);
  const pivoted = isYes(catalogChanged);
  const visual = isYes(isVisualLifestyle);

  const usableHistory = history && !pivoted;
  const convs = usableHistory ? monthlyConversions : 0;

  const warnings = [];
  const notes = [];

  // --- Subscription / LTV nuance ---------------------------------------
  const checkoutGuess = (priceLow + priceHigh) / 2;
  const estimatedLTV = isSub ? checkoutGuess * (retentionMonths || 1) : undefined;
  if (isSub) {
    notes.push(
      `Subscription business — configure the conversion action to report the ~$${Math.round(
        estimatedLTV
      )} LTV (${retentionMonths || 1} mo retention × ~$${Math.round(
        checkoutGuess
      )} checkout), not the raw checkout price. Any future CPA/ROAS target should be benchmarked against that LTV too.`
    );
  }

  // --- Node 1: structural campaign-type candidates ----------------------
  const shoppingCandidate = !isSub;
  if (isSub) {
    notes.push(
      "Shopping excluded — subscription/recurring-revenue businesses don't fit the single-item-bought-and-shipped Shopping format, regardless of catalog size or plan-variant count."
    );
  }
  const searchCandidate = true; // near-universal default per the doc; not a live branch

  const videoCandidateStructural = visual;
  const localCandidateStructural = store;

  const pmaxQualifies =
    usableHistory && convs >= PMAX_CONVERSION_THRESHOLD && catalogSize >= PMAX_SKU_THRESHOLD;

  if (history && pivoted) {
    notes.push(
      "Account has ad history, but the catalog/business pivoted since it was generated — treated as net-new (no usable history) for budget-anchoring, Performance Max eligibility, and the Brand-search automation exception."
    );
  }

  // --- Budget gate on the core types (Node 1 + the single-campaign fallback) ---
  let includeShopping = shoppingCandidate;
  let includeSearch = searchCandidate;
  const coreCandidateCount = (shoppingCandidate ? 1 : 0) + (searchCandidate ? 1 : 0);

  if (coreCandidateCount === 2 && monthlyBudget / 2 < FLOOR) {
    // Can't fund both core types at the floor — concentrate into one.
    includeSearch = false; // Shopping preferred: lower CPC, faster path to real conversion data
    notes.push(
      `Budget too tight to fund both Shopping and Search at the ~$${FLOOR}/mo floor — concentrating into Shopping only (lower CPC than Search ⇒ more clicks per dollar ⇒ faster path to real conversion data).`
    );
    if (monthlyBudget < SHOPPING_MIN_VIABLE) {
      warnings.push(
        `Even concentrated into one Shopping campaign, $${monthlyBudget}/mo is below the ~$${SHOPPING_MIN_VIABLE} minimum to make meaningful progress — consider holding off on Google Ads until budget grows.`
      );
    } else if (monthlyBudget < FLOOR) {
      warnings.push(
        `$${monthlyBudget}/mo is still below the ideal ~$${FLOOR} floor even concentrated into one campaign — expect a slower-than-usual ramp to automated bidding, not a full pass.`
      );
    }
  } else if (coreCandidateCount === 1 && !shoppingCandidate && monthlyBudget < FLOOR) {
    // Subscription business, Search is the only core option, and budget is thin.
    warnings.push(
      `$${monthlyBudget}/mo is below the ~$${FLOOR} floor for a single Search campaign to realistically earn its way to automated bidding — expect a slow ramp.`
    );
  }

  // Hold-off case: budget can't clear a meaningful fraction of the floor even concentrated.
  if (monthlyBudget < SHOPPING_MIN_VIABLE && !(coreCandidateCount === 2 && includeSearch)) {
    // Already warned above for the Shopping-fallback path; cover the
    // Search-only (subscription) path here too.
    if (!shoppingCandidate) {
      warnings.push(
        `$${monthlyBudget}/mo is very thin for even a single Search campaign — consider holding off until budget grows, or expect a very slow ramp.`
      );
    }
  }

  // --- Experimental candidates (Video / Local), gated by budget room ----
  // A candidate is structurally eligible per Node 1, but only worth standing
  // up if the resulting test budget clears a minimal, meaningful amount.
  const experimentalCandidates = [];
  if (videoCandidateStructural) experimentalCandidates.push("video");
  if (localCandidateStructural) experimentalCandidates.push("local");

  const nonPmaxExperimentalPct = 13.2; // mid-point of the doc's 10-15% combined experimental bucket
  const pmaxExperimentalPct = 6; // per the doc's specific PMax-mode calibration
  const experimentalPct = pmaxQualifies ? pmaxExperimentalPct : nonPmaxExperimentalPct;
  const perExperimentalPct =
    experimentalCandidates.length > 0 ? experimentalPct / experimentalCandidates.length : 0;
  const estExperimentalDollarEach = monthlyBudget * (perExperimentalPct / 100);

  let includeVideo = false;
  let includeLocal = false;
  if (experimentalCandidates.length > 0) {
    if (estExperimentalDollarEach >= MIN_EXPERIMENTAL_DOLLAR) {
      includeVideo = videoCandidateStructural;
      includeLocal = localCandidateStructural;
    } else {
      notes.push(
        `Video/Local structurally eligible but budget doesn't leave room to fund a test budget productively (~$${Math.round(
          estExperimentalDollarEach
        )}/mo each, under the ~$${MIN_EXPERIMENTAL_DOLLAR} minimum) — deferred to Phase 2 once budget grows.`
      );
    }
  }

  if (includeLocal) {
    notes.push(
      "Local / store-visit tracking is typically implemented as a goal within Performance Max (or Smart bidding on Shopping/Search) rather than its own separate campaign object in current Google Ads — budgeted here as a distinct line for planning clarity."
    );
  }

  // --- Node 2: Brand vs. Non-Brand split (Search only) -------------------
  // Approximate Search's tentative total before the final normalization
  // pass, just to judge whether a split would leave both halves usable.
  const searchWeightPctEstimate = pmaxQualifies ? 14 : 34.2;
  const searchTotalEstimate = includeSearch ? monthlyBudget * (searchWeightPctEstimate / 100) : 0;
  const splitBrand = includeSearch && brand && searchTotalEstimate >= 2 * FLOOR;
  if (includeSearch && brand && !splitBrand) {
    notes.push(
      "Brand search demand exists, but budget isn't large enough to split productively yet — combined into one Search campaign for now; watch brand-term performance inside it and split once budget or brand awareness grows."
    );
  }

  // --- Node 3: Shopping price/margin tier split --------------------------
  const priceRatio = priceLow > 0 ? priceHigh / priceLow : Infinity;
  let splitTiers = includeShopping && priceRatio >= PRICE_VARIANCE_RATIO;

  // --- Node 4: Budget allocation ------------------------------------------
  function buildSlots() {
    const slots = [];
    if (pmaxQualifies) {
      if (includeShopping) slots.push({ key: "shopping", weight: 72 });
      if (includeSearch) {
        if (splitBrand) {
          slots.push({ key: "search_brand", weight: 14 * 0.307 });
          slots.push({ key: "search_nonbrand", weight: 14 * 0.693 });
        } else {
          slots.push({ key: "search", weight: 14 });
        }
      }
      slots.push({ key: "pmax", weight: 8 });
      if (includeVideo) slots.push({ key: "video", weight: pmaxExperimentalPct / (includeLocal ? 2 : 1) });
      if (includeLocal) slots.push({ key: "local", weight: pmaxExperimentalPct / (includeVideo ? 2 : 1) });
    } else {
      if (includeShopping) slots.push({ key: "shopping", weight: 52.6 });
      if (includeSearch) {
        if (splitBrand) {
          slots.push({ key: "search_brand", weight: 10.5 });
          slots.push({ key: "search_nonbrand", weight: 23.7 });
        } else {
          slots.push({ key: "search", weight: 34.2 });
        }
      }
      if (includeVideo)
        slots.push({ key: "video", weight: nonPmaxExperimentalPct / (includeLocal ? 2 : 1) });
      if (includeLocal)
        slots.push({ key: "local", weight: nonPmaxExperimentalPct / (includeVideo ? 2 : 1) });
    }
    return slots;
  }

  function expandShoppingTiers(slots) {
    if (!splitTiers) return slots;
    return slots.flatMap((s) => {
      if (s.key !== "shopping") return [s];
      return [
        { key: "shopping_premium", weight: s.weight * 0.6 },
        { key: "shopping_everyday", weight: s.weight * 0.4 },
      ];
    });
  }

  function toDollars(slots) {
    const sumWeights = slots.reduce((a, s) => a + s.weight, 0);
    const withRaw = slots.map((s) => ({ ...s, amount: round10(monthlyBudget * (s.weight / sumWeights)) }));
    const total = withRaw.reduce((a, s) => a + s.amount, 0);
    const diff = round10(monthlyBudget - total);
    if (diff !== 0 && withRaw.length > 0) {
      const biggest = withRaw.reduce((a, b) => (b.amount > a.amount ? b : a));
      biggest.amount += diff;
    }
    return withRaw;
  }

  let slots = expandShoppingTiers(buildSlots());
  let dollarSlots = toDollars(slots);

  // Node 4 step 4 / Node 5 math: verify every campaign clears its own floor.
  // Core splits that fail get merged back — experimental test budgets are
  // allowed to sit below floor (that's the point of a small test budget),
  // they just get a warning instead.
  function amountFor(key) {
    const s = dollarSlots.find((d) => d.key === key);
    return s ? s.amount : 0;
  }

  let recompute = false;
  if (splitTiers) {
    const premium = amountFor("shopping_premium");
    const everyday = amountFor("shopping_everyday");
    if (premium < FLOOR || everyday < FLOOR) {
      splitTiers = false;
      notes.push(
        `Price/margin tier split would leave one Shopping tier under the ~$${FLOOR}/mo floor — running Shopping as one campaign for now; revisit the split once budget grows.`
      );
      recompute = true;
    }
  }
  let brandSplitActive = splitBrand;
  if (brandSplitActive) {
    const b = amountFor("search_brand");
    const nb = amountFor("search_nonbrand");
    if (b < FLOOR || nb < FLOOR) {
      brandSplitActive = false;
      notes.push(
        `Brand/Non-Brand split would leave one Search campaign under the ~$${FLOOR}/mo floor — combined into one Search campaign for now.`
      );
      recompute = true;
    }
  }

  if (recompute) {
    // Rebuild with the (possibly reverted) split flags.
    const slots2 = [];
    const buildWithFlags = () => {
      const s = [];
      if (pmaxQualifies) {
        if (includeShopping) s.push({ key: "shopping", weight: 72 });
        if (includeSearch) {
          if (brandSplitActive) {
            s.push({ key: "search_brand", weight: 14 * 0.307 });
            s.push({ key: "search_nonbrand", weight: 14 * 0.693 });
          } else {
            s.push({ key: "search", weight: 14 });
          }
        }
        s.push({ key: "pmax", weight: 8 });
        if (includeVideo) s.push({ key: "video", weight: pmaxExperimentalPct / (includeLocal ? 2 : 1) });
        if (includeLocal) s.push({ key: "local", weight: pmaxExperimentalPct / (includeVideo ? 2 : 1) });
      } else {
        if (includeShopping) s.push({ key: "shopping", weight: 52.6 });
        if (includeSearch) {
          if (brandSplitActive) {
            s.push({ key: "search_brand", weight: 10.5 });
            s.push({ key: "search_nonbrand", weight: 23.7 });
          } else {
            s.push({ key: "search", weight: 34.2 });
          }
        }
        if (includeVideo) s.push({ key: "video", weight: nonPmaxExperimentalPct / (includeLocal ? 2 : 1) });
        if (includeLocal) s.push({ key: "local", weight: nonPmaxExperimentalPct / (includeVideo ? 2 : 1) });
      }
      return s;
    };
    slots = expandShoppingTiers(buildWithFlags());
    dollarSlots = toDollars(slots);
  }

  // Only-one-qualifying-type note (Node 4: "no allocation decision to make").
  const topLevelTypeCount =
    (includeShopping ? 1 : 0) +
    (includeSearch ? 1 : 0) +
    (includeVideo ? 1 : 0) +
    (includeLocal ? 1 : 0) +
    (pmaxQualifies ? 1 : 0);
  if (topLevelTypeCount === 1) {
    notes.push(
      "Only one campaign type qualifies right now — the full budget goes here by default, not a proportional allocation decision."
    );
  }

  if (pmaxQualifies && (brandSplitActive || (includeSearch && brand))) {
    notes.push(
      "PMax can pick up branded search traffic and get credited for sales Search – Brand was already closing — add brand-term negative keywords/exclusions to PMax."
    );
  }

  // Floor warnings for whatever's left (informational, not auto-collapsed).
  dollarSlots.forEach((s) => {
    if (s.amount < FLOOR) {
      if (s.key === "video" || s.key === "local") {
        notes.push(
          `${labelFor(s.key)} is below the ~$${FLOOR}/mo automation floor — expected for a small test budget; it'll likely stay on manual bidding for a while.`
        );
      } else {
        warnings.push(
          `${labelFor(s.key)} is under the ~$${FLOOR}/mo floor at $${s.amount}/mo — it won't realistically accumulate enough conversions to leave manual bidding. Consider merging it or reducing the number of campaigns running this month.`
        );
      }
    }
  });

  // --- Labels, allocation reasoning, bidding, observation windows --------
  function labelFor(key) {
    return {
      shopping: "Shopping",
      shopping_premium: "Shopping – Premium",
      shopping_everyday: "Shopping – Everyday",
      search: "Search",
      search_brand: "Search – Brand",
      search_nonbrand: "Search – Non-Brand",
      video: "Video/Display",
      local: "Local / Store-Visit",
      pmax: "Performance Max",
    }[key];
  }

  function allocationReasonFor(key) {
    switch (key) {
      case "shopping":
        return topLevelTypeCount === 1 && !includeSearch
          ? "Only qualifying campaign type this month — gets the full budget by default."
          : "Typically the highest-volume converter for ecommerce — funded as the largest single share.";
      case "shopping_premium":
        return "Higher price/margin tier weighted heavier — more revenue per sale, and can absorb a higher ROAS/CPA before becoming unprofitable.";
      case "shopping_everyday":
        return "Lower price/margin tier gets a lighter but still meaningful share — thinner margin needs tighter, more efficient spend.";
      case "search":
        return topLevelTypeCount === 1
          ? "Only qualifying campaign type this month — gets the full budget by default."
          : "Brand and non-brand demand combined into one campaign — budget or brand awareness isn't yet enough to split productively without starving both sides.";
      case "search_brand":
        return "Brand search converts cheaply and reliably, but demand is naturally capped by how many people search your name — funded fully, but it doesn't need a large share.";
      case "search_nonbrand":
        return "Real demand, but more competitive/expensive than brand — a solid secondary share with real headroom to absorb more budget productively.";
      case "video":
        return "Experimental/unproven for this account — capped at a small, fixed test budget rather than a proportional share, even though the product category fits it.";
      case "local":
        return "Experimental/unproven for this account — capped at a small, fixed test budget to test store-visit signal without over-committing.";
      case "pmax":
        return "Account already clears PMax's data preconditions (usable conversion history + catalog scale) — added on top of the Shopping/Search foundation as a meaningful but minority slice, not carved out of what's already working.";
      default:
        return "";
    }
  }

  function biddingFor(key, amount) {
    if (key === "pmax") {
      return {
        strategy: "Maximize Conversion Value",
        reason:
          "PMax has no Manual CPC option, and its Node 1 preconditions (30+ conversions/month, 50+ SKUs) mean the account already clears the data bar automated bidding needs — it skips the earn-in phase entirely.",
        graduatesTo: "Target ROAS",
        graduationTrigger: "~50 conversions/30 days",
        observationWindow: `No earn-in wait needed — monitor weekly and move to Target ROAS once ~50 conversions/30 days accumulate (${fmtWeeks(
          weeksToConversions(amount, 50)
        )} at this budget, ~$${EST_CPA} est. CPA).`,
      };
    }
    if (key === "search_brand") {
      if (pivoted) {
        return {
          strategy: "Manual CPC / Maximize Clicks",
          reason:
            "Normally Brand search is safe to automate early because the traffic is predictable — but a catalog/business pivot breaks that: searchers may still expect the old product line, so this campaign starts with no automation exception despite being 'Brand'.",
          graduatesTo: "Maximize Conversions",
          graduationTrigger: "~15-20 conversions/30 days",
          observationWindow: observationWindowFor(amount, 0),
        };
      }
      return {
        strategy: "Maximize Conversions (or Maximize Conversion Value)",
        reason:
          "Brand search is naturally low-variance, high-intent traffic — safe to automate even with zero campaign-specific data, because the segment's conversion pattern is already predictable (this holds even without Google-specific history, if real-world brand recognition exists elsewhere).",
        graduatesTo: "Target CPA / Target ROAS",
        graduationTrigger: "~30-50 conversions/30 days",
        observationWindow: observationWindowFor(amount, 15),
      };
    }
    // search_nonbrand, search (combined), shopping / shopping_premium / shopping_everyday, video, local
    return {
      strategy: "Manual CPC / Maximize Clicks",
      reason:
        "No conversion history yet for this specific campaign — automated bidding needs real data to make good decisions, and feeding it nothing lets it guess blindly and waste spend.",
      graduatesTo: "Maximize Conversions",
      graduationTrigger: "~15-20 conversions/30 days",
      observationWindow: observationWindowFor(amount, 0),
    };
  }

  const campaigns = dollarSlots.map((s) => ({
    key: s.key,
    label: labelFor(s.key),
    amount: s.amount,
    pctDisplay: Math.round((s.amount / monthlyBudget) * 1000) / 10,
    allocation: { reason: allocationReasonFor(s.key) },
    bidding: biddingFor(s.key, s.amount),
  }));

  if (pmaxQualifies) {
    notes.push(
      "Performance Max qualifies (usable conversion history ≥30/month + catalog ≥50 SKUs) — added alongside Standard Shopping/Search, not replacing them."
    );
  } else if (usableHistory || catalogSize > 0) {
    const gaps = [];
    if (convs < PMAX_CONVERSION_THRESHOLD)
      gaps.push(`~${convs}/${PMAX_CONVERSION_THRESHOLD}+ monthly conversions`);
    if (catalogSize < PMAX_SKU_THRESHOLD) gaps.push(`${catalogSize}/${PMAX_SKU_THRESHOLD}+ SKUs`);
    if (gaps.length) {
      notes.push(
        `Performance Max not yet a candidate (${gaps.join(
          ", "
        )}) — concentrate spend on Shopping/Search until both preconditions clear.`
      );
    }
  }

  return {
    budget: monthlyBudget,
    campaigns,
    warnings,
    notes,
    isSubscription: isSub,
    estimatedLTV,
    checkoutGuess,
  };
}

module.exports = { computePlan };
