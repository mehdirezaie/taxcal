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

function tentativeAMT(amti, status) {
  const taxable = Math.max(0, amti - amtExemption(amti,status));
  const bracket = AMT_BRACKET[status];
  return taxable <= bracket
    ? taxable * AMT_RATE_1
    : bracket * AMT_RATE_1 + (taxable - bracket) * AMT_RATE_2;
}

function calculate() {
  const status = $("status").value;
  const salary = Number($("salary").value) || 0;
  const pretax401k = Number($("pretax401k").value) || 0;
  const hsa = Number($("hsa").value) || 0;

  const rsus = readGrants("rsus");
  const isos = readGrants("isos");
  const nsos = readGrants("nsos");

  const rsuIncome = rsus.reduce((s,x) => s + x.shares * (x.price || 0), 0);
  const nsoIncome = nsos.reduce((s,x) => s + x.shares * ((x.fmv||0)-(x.strike||0)), 0);
  const isoAdjustment = isos.reduce((s,x) => s + x.shares * ((x.fmv||0)-(x.strike||0)), 0);
  const isoCost = isos.reduce((s,x) => s + x.shares * (x.strike||0), 0);
  const isoExerciseValue = isos.reduce((s,x) => s + x.shares * (x.strike || 0),0);
  const isoLimitWarning = isoExerciseValue > 100000;

  const grossIncome = salary + rsuIncome + nsoIncome;
  const taxableIncome = Math.max(0, grossIncome - pretax401k - hsa - STANDARD_DEDUCTION[status]);
  const regularTax = federalTax(taxableIncome, status);

  // AMTI = taxable income + ISO AMT adjustment + standard deduction.
  const amti = taxableIncome + isoAdjustment + STANDARD_DEDUCTION[status];
  const exemption = amtExemption(amti, status);
  const tentative = tentativeAMT(amti, status);
  const additionalAMT = Math.max(0, tentative - regularTax);
  const totalFederalTax = regularTax + additionalAMT;

  const rows = [
    ["Salary", salary],
    ["RSU Income", rsuIncome],
    ["NSO Income", nsoIncome],
    ["ISO AMT Adjustment", isoAdjustment],
    ["ISO Exercise Cost", isoCost],
    ["Taxable Income", taxableIncome],
    ["Regular Federal Tax", regularTax],
    ["AMTI", amti],
    ["AMT Exemption", exemption],
    ["Tentative AMT", tentative],
    ["Additional AMT", additionalAMT],
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

addGrant("rsus","rsu",{shares:100,price:400});
addGrant("isos","iso",{shares:20,strike:300,fmv:400});
addGrant("nsos","nso",{shares:30,strike:300,fmv:400});
calculate();
