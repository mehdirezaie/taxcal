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

const NIIT_THRESHOLD = {single:200000, married:250000};
const NIIT_RATE = .038;

const $ = id => document.getElementById(id);
const money = n => (n < 0 ? "-$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");

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

// LTCG/QDI inside AMTI are taxed at 0/15/20%, not 26/28%.
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

function niitTax(magi, netInvestmentIncome, status) {
  const excess = Math.max(0, magi - NIIT_THRESHOLD[status]);
  return Math.min(netInvestmentIncome, excess) * NIIT_RATE;
}

function calculate() {
  const status = $("status").value;
  const salary = Number($("salary").value) || 0;
  const saltInput = $("saltDeduction").value;
  const otherInput = $("otherItemized").value;
  const pretax401k = Number($("pretax401k").value) || 0;
  const hsa = Number($("hsa").value) || 0;
  const ltcg = Number($("ltcg").value) || 0;
  const qualifiedDividends = Number($("qualDiv").value) || 0;
  const interestIncome = Number($("interestIncome").value) || 0;
  const nonQualDiv = Number($("nonQualDiv").value) || 0;
  const rentalRoyalty = Number($("rentalRoyalty").value) || 0;

  const hasItemized = saltInput !== "" || otherInput !== "";
  const saltDeduction = Number(saltInput) || 0;
  const otherItemized = Number(otherInput) || 0;
  const totalItemized = saltDeduction + otherItemized;
  const usingItemized = hasItemized && totalItemized > STANDARD_DEDUCTION[status];
  const deduction = usingItemized ? totalItemized : STANDARD_DEDUCTION[status];
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

  // LTCG + qualified dividends are tax differently than the ordinary income
  const grossIncome = salary + rsuIncome + nsoIncome + interestIncome + nonQualDiv + rentalRoyalty;
  const taxableIncome = Math.max(0, grossIncome - pretax401k - hsa - deduction);
  const capGainsTax = ltcgTax(taxableIncome, totalCapGains, status);
  const regularTax = federalTax(taxableIncome, status) + capGainsTax;

  const amtiAddback = usingItemized ? saltDeduction : STANDARD_DEDUCTION[status];
  const amti = taxableIncome + isoAdjustment + amtiAddback + totalCapGains;
  
  const exemption = amtExemption(amti, status);
  const tentative = tentativeAMTWithCapGains(amti, totalCapGains, status);
  const additionalAMT = Math.max(0, tentative - regularTax);

  // no foreign-income addbacks tracke
  const magi = grossIncome - pretax401k - hsa;
  const niit = niitTax(magi, netInvestmentIncome, status);

  const totalFederalTax = regularTax + additionalAMT + niit;
  const summaryRows = [
    {
      label: "Total Income",
      value: grossIncome + totalCapGains,
      breakdown: [
        ["Salary", salary], ["RSU Income", rsuIncome], ["NSO Income", nsoIncome],
        ["Interest Income", interestIncome], ["Non-Qualified Dividends", nonQualDiv],
        ["Rental/Royalty Income", rentalRoyalty],
        ["Long-Term Capital Gains", ltcg], ["Qualified Dividends", qualifiedDividends]
      ]
    },
    {
      label: "Taxable Income",
      value: taxableIncome + totalCapGains,
      breakdown: [
        ["Total Income", grossIncome + totalCapGains],
        ["Pre-tax 401(k)", -pretax401k], ["HSA", -hsa], ["Deduction Used", -deduction]
      ]
    },   
    {
      label: "Regular Federal Tax",
      value: regularTax,
      breakdown: [["Ordinary Tax", regularTax - capGainsTax], ["Capital Gains Tax", capGainsTax]]
    },
    {
      label: "AMT",
      value: additionalAMT,
      breakdown: [["Tentative AMT", tentative], ["Less: Regular Tax", -regularTax]]
    },
    {
      label: "Net Investment Income Tax",
      value: niit,
      breakdown: [["MAGI", magi], ["Net Investment Income", netInvestmentIncome]]
    },
    { label: "Total Federal Tax", value: totalFederalTax, breakdown: null, highlight: true }
  ];


  $("results").innerHTML =
    (isoLimitWarning
      ? `<div class="warning">
          ⚠️ ISO exercise value is above $100,000. The $100,000 ISO limitation
          should be reviewed separately; this calculator does not automatically
          reclassify excess options as NSOs. Lower the number of shares!
         </div>`
      : "") +
    summaryRows.map(r => `
      <div class="result-row ${r.highlight ? "highlight" : ""} ${r.breakdown ? "has-tooltip" : ""}">
        <span>${r.label}</span><strong>${money(r.value)}</strong>
        ${r.breakdown ? `
          <div class="tooltip">
            ${r.breakdown.map(([k,v]) => `<div class="tooltip-row"><span>${k}</span><span>${money(v)}</span></div>`).join("")}
          </div>` : ""}
      </div>
    `).join("");

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
