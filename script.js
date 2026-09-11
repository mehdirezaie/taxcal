// https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
const FEDERAL_BRACKETS = {
  single: [[12400,.10],[50400,.12],[105700,.22],[201775,.24],[256225,.32],[640600,.35],[Infinity,.37]],
  married: [[24800,.10],[100800,.12],[211400,.22],[403550,.24],[512450,.32],[768700,.35],[Infinity,.37]]
};
const STANDARD_DEDUCTION = {single:16100, married:32200};
const AMT_EXEMPTION = {single:90100, married:140200};
const AMT_PHASEOUT_START = {single:500000, married:1000000};
const AMT_PHASEOUT_RATE = .5;
const AMT_BRACKET = {single:244500, married:122250};
const AMT_RATE_1 = .26, AMT_RATE_2 = .28;

// Rev. Proc. 2025-32 — 2026 LTCG / qualified dividend brackets
const LTCG_BRACKETS = {
  single: [[49450,0],[545500,.15],[Infinity,.20]],
  married: [[98900,0],[613700,.15],[Infinity,.20]]
};

// Net Investment Income Tax — thresholds fixed by statute, not inflation-adjusted
const NIIT_THRESHOLD = {single:200000, married:250000};
const NIIT_RATE = .038;

const $ = id => document.getElementById(id);
const money = n => "$" + Math.round(n).toLocaleString("en-US");

function addGrant(container, type, values={shares:"", strike:"", fmv:""}) {
  const div = document.createElement("div");
  div.className = "grant";
  const fields = type === "rsu"
    ? [["shares","Shares"],["price","Vesting price"]]
    : [["shares","Shares"],["strike","Strike price"],["fmv","FMV at exercise"]];
  div.innerHTML = fields.map(([key,label]) =>
    `<label>${label}<input type="number" min="0" step="0.01" data-key="${key}" value="${values[key] ?? ""}"></label>`
  ).join("") + `<button type="button" class="remove">Remove</button>`;
  div.querySelector(".remove").onclick = () => div.remove();
  $(container).appendChild(div);
}

function readGrants(container) {
  return [...$(container).children].map(row => {
    const obj = {};
    row.querySelectorAll("input").forEach(i => obj[i.dataset.key] = Number(i.value) || 0);
    return obj;
  });
}

function federalTax(income, status) {
  let tax = 0, previous = 0;
  for (const [limit, rate] of FEDERAL_BRACKETS[status]) {
    const taxable = Math.min(income, limit) - previous;
    if (taxable <= 0) break;
    tax += taxable * rate;
    previous = limit;
  }
  return tax;
}

function amtExemption(amti, status) {
  const base = AMT_EXEMPTION[status], start = AMT_PHASEOUT_START[status];
  if (amti <= start) return base;
  return Math.max(0, base - (amti - start) * AMT_PHASEOUT_RATE);
}

// LTCG/QDI tax, stacked on top of baseIncome (ordinary taxable income or ordinary AMTI base)
function ltcgTax(baseIncome, capGainsAmount, status) {
  let tax = 0, stackStart = baseIncome, previous = 0;
  const stackEnd = baseIncome + capGainsAmount;
  for (const [limit, rate] of LTCG_BRACKETS[status]) {
    const bandLow = Math.max(previous, stackStart);
    const bandHigh = Math.min(limit, stackEnd);
    if (bandHigh > bandLow) tax += (bandHigh - bandLow) * rate;
    previous = limit;
  }
  return tax;
}

// AMT with capital-gains carve-out (Form 6251 Part III): LTCG/QDI inside AMTI
// are taxed at 0/15/20%, not 26/28%. Only the ordinary portion of AMTI
// (after exemption) gets the 26/28% AMT rates; cap gains stack on top of that.
function tentativeAMTWithCapGains(amti, capGainsInAMTI, status) {
  const exemption = amtExemption(amti, status);
  const ordinaryAMTIBase = Math.max(0, amti - capGainsInAMTI - exemption);
  const bracket = AMT_BRACKET[status];
  const ordinaryAMTTax = ordinaryAMTIBase <= bracket
    ? ordinaryAMTIBase * AMT_RATE_1
    : bracket * AMT_RATE_1 + (ordinaryAMTIBase - bracket) * AMT_RATE_2;
  const capGainsAMTTax = ltcgTax(ordinaryAMTIBase, capGainsInAMTI, status);
  return ordinaryAMTTax + capGainsAMTTax;
}

// 3.8% Net Investment Income Tax on the lesser of net investment income or MAGI over threshold
function niitTax(magi, netInvestmentIncome, status) {
  const excess = Math.max(0, magi - NIIT_THRESHOLD[status]);
  return Math.min(netInvestmentIncome, excess) * NIIT_RATE;
}

function calculate() {
  const status = $("status").value;
  const salary = Number($("salary").value) || 0;
  const pretax401k = Number($("pretax401k").value) || 0;
  const hsa = Number($("hsa").value) || 0;

  const ltcg = Number($("ltcg").value) || 0;
  const qualifiedDividends = Number($("qualDiv").value) || 0;
  const interestIncome = Number($("interestIncome").value) || 0;
  const nonQualDiv = Number($("nonQualDiv").value) || 0;
  const rentalRoyalty = Number($("rentalRoyalty").value) || 0;

  const totalCapGains = ltcg + qualifiedDividends;
  const otherInvestmentIncome = interestIncome + nonQualDiv + rentalRoyalty;
  const netInvestmentIncome = totalCapGains + otherInvestmentIncome;

  const rsus = readGrants("rsus");
  const isos = readGrants("isos");
  const nsos = readGrants("nsos");

  const rsuIncome = rsus.reduce((s,x) => s + x.shares * (x.price || 0), 0);
  const nsoIncome = nsos.reduce((s,x) => s + x.shares * ((x.fmv||0)-(x.strike||0)), 0);
  const isoAdjustment = isos.reduce((s,x) => s + x.shares * ((x.fmv||0)-(x.strike||0)), 0);
  const isoCost = isos.reduce((s,x) => s + x.shares * (x.strike||0), 0);
  const isoExerciseValue = isos.reduce((s,x) => s + x.shares * (x.strike || 0),0);
  const isoLimitWarning = isoExerciseValue > 100000;

  // Non-qualified dividends, interest, and rental/royalty are ordinary income.
  // LTCG + qualified dividends are NOT added here — they stack on top separately.
  const grossIncome = salary + rsuIncome + nsoIncome + interestIncome + nonQualDiv + rentalRoyalty;
  const taxableIncome = Math.max(0, grossIncome - pretax401k - hsa - STANDARD_DEDUCTION[status]);

  const capGainsTax = ltcgTax(taxableIncome, totalCapGains, status);
  const regularTax = federalTax(taxableIncome, status) + capGainsTax;

  // AMTI = ordinary taxable income + ISO AMT adjustment + standard deduction + cap gains.
  const amti = taxableIncome + isoAdjustment + STANDARD_DEDUCTION[status] + totalCapGains;
  const exemption = amtExemption(amti, status);
  const tentative = tentativeAMTWithCapGains(amti, totalCapGains, status);
  const additionalAMT = Math.max(0, tentative - regularTax);

  // MAGI ≈ AGI here (no foreign-income addbacks tracked).
  const magi = grossIncome - pretax401k - hsa;
  const niit = niitTax(magi, netInvestmentIncome, status);

  const totalFederalTax = regularTax + additionalAMT + niit;

  const rows = [
    ["Salary", salary],
    ["RSU Income", rsuIncome],
    ["NSO Income", nsoIncome],
    ["ISO AMT Adjustment", isoAdjustment],
    ["ISO Exercise Cost", isoCost],
    ["Interest Income", interestIncome],
    ["Non-Qualified Dividends", nonQualDiv],
    ["Rental/Royalty Income", rentalRoyalty],
    ["Long-Term Capital Gains", ltcg],
    ["Qualified Dividends", qualifiedDividends],
    ["Taxable Income", taxableIncome],
    ["Capital Gains Tax", capGainsTax],
    ["Regular Federal Tax", regularTax],
    ["AMTI", amti],
    ["AMT Exemption", exemption],
    ["Tentative AMT", tentative],
    ["Additional AMT", additionalAMT],
    ["MAGI", magi],
    ["Net Investment Income Tax", niit],
    ["Total Federal Tax", totalFederalTax]
  ];

$("results").innerHTML =
  (isoLimitWarning
    ? `<div class="warning">
        ⚠️ ISO exercise value is above $100,000. The $100,000 ISO limitation
        should be reviewed separately; this calculator does not automatically
        reclassify excess options as NSOs. Lower the number of shares!
       </div>`
    : "") +
  rows.map(([k,v]) =>
    `<div class="result-row ${k==="Total Federal Tax" ? "highlight":""}">
      <span>${k}</span><strong>${money(v)}</strong>
    </div>`
  ).join("");

  $("cashResults").innerHTML = [
    ["ISO Exercise Cost", isoCost],
    ["Additional AMT", additionalAMT],
    ["Total Cash Required", isoCost + additionalAMT]
  ].map(([k,v]) =>
    `<div class="result-row ${k==="Total Cash Required" ? "highlight":""}">
      <span>${k}</span><strong>${money(v)}</strong>
    </div>`
  ).join("");
}

$("addRsu").onclick = () => addGrant("rsus","rsu");
$("addIso").onclick = () => addGrant("isos","iso");
$("addNso").onclick = () => addGrant("nsos","nso");
$("calculate").onclick = calculate;

// Load the example from the supplied Python code.
addGrant("rsus","rsu",{shares:1,price:400});
addGrant("isos","iso",{shares:2,strike:300,fmv:400});
addGrant("nsos","nso",{shares:3,strike:300,fmv:400});
calculate();
