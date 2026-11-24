"use strict";

// This is the fitted Constant × RationalQuadratic kernel. WhiteKernel contributes
// zero cross-covariance between a query and training points when predicting a mean.
function predictRecipe(models, {age, na, ms, wb, react}) {
  const input = [Math.log1p(age), na, ms, wb, react];
  const estimates = models.map(model => {
    const query = input.map((v, i) => (v - model.mean[i]) / model.scale[i]);
    const denominator = 2 * model.alpha * model.length ** 2;
    let sum = 0;
    for (const center of model.centers) {
      let squaredDistance = center[5]; // Precomputed contribution of the ten fixed inputs.
      for (let i = 0; i < query.length; i++) {
        squaredDistance += (query[i] - center[i]) ** 2;
      }
      const kernel = model.amplitude * (1 + squaredDistance / denominator) ** -model.alpha;
      sum += kernel * center[6];
    }
    return Math.max(0, sum * model.targetScale + model.targetMean);
  });
  return {
    mean: estimates.reduce((a, b) => a + b, 0) / estimates.length,
    low: Math.min(...estimates),
    high: Math.max(...estimates)
  };
}

let modelRequest;
function getModels() {
  if (window.gprModels) return Promise.resolve(window.gprModels);
  if (!modelRequest) {
    modelRequest = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "data/gpr-model.js";
      script.onload = () => window.gprModels?.length === 10
        ? resolve(window.gprModels) : reject(Error("The GPR model file is incomplete."));
      script.onerror = () => reject(Error("Could not open data/gpr-model.js. Check that the local site folder is complete and try again."));
      document.head.append(script);
    }).catch(error => { modelRequest = undefined; throw error; });
  }
  return modelRequest;
}

const recipeFields = ["age", "na", "ms", "wb", "react"];
let startingRecipe, curve = [], revision = 0, timer;
const baselineByAge = new Map();

function openRecipe(record) {
  if (record || !startingRecipe) {
    startingRecipe = record || rows[0] || {
      age: filters.a.age, na: 5, ms: 1, wb: Number(filters.a.wb) || 0.4, react: 298
    };
    baselineByAge.clear();
    restoreRecipeInputs();
  }
  $("find-view").hidden = true;
  $("recipe-view").hidden = false;
  $("find-mode").setAttribute("aria-pressed", "false");
  $("recipe-mode").setAttribute("aria-pressed", "true");
  $("summary").textContent = "Adjust the mix proportions or curing age to see how predicted strength changes.";
  $("recipe-origin").textContent = startingRecipe.id == null
    ? "Starting from a reference paste."
    : "Starting from " + mixName(startingRecipe) + " at " + startingRecipe.age + " days.";
  return refreshRecipe();
}

function restoreRecipeInputs() {
  for (const field of recipeFields) $("recipe-" + field).value = startingRecipe[field];
}

function recipeStatus(message) {
  curve = [];
  $("recipe-status").textContent = message;
  $("recipe-ages").replaceChildren();
  renderMetrics($("recipe-metrics"), [
    ["Predicted strength", "—"], ["Change from starting recipe", "—"], ["Explorer target", fmt(filters.a.target) + " MPa"]
  ]);
  drawRecipe();
}

async function refreshRecipe() {
  const version = ++revision, draft = {};
  for (const field of recipeFields) {
    const input = $("recipe-" + field);
    if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) {
      recipeStatus("Enter " + input.labels[0].firstChild.textContent.trim().toLowerCase() +
        " between " + input.min + " and " + input.max + ".");
      return;
    }
    draft[field] = input.valueAsNumber;
  }
  if (!window.gprModels) recipeStatus("Loading the fitted GPR models…");
  try {
    const models = await getModels();
    if (version !== revision || $("recipe-view").hidden) return;
    const days = [...new Set([...ages, draft.age])].sort((a, b) => a - b);
    const sameRecipe = recipeKey(draft) === recipeKey(startingRecipe);
    curve = days.map(age => {
      if (!baselineByAge.has(age)) {
        baselineByAge.set(age, predictRecipe(models, {...startingRecipe, age}));
      }
      const base = baselineByAge.get(age);
      const current = sameRecipe ? base : predictRecipe(models, {...draft, age});
      return {age, ...current, base: base.mean, selected: age === draft.age};
    });
    const point = curve.find(row => row.selected);
    const delta = point.mean - point.base;
    renderMetrics($("recipe-metrics"), [
      ["Predicted at " + draft.age + " days", fmt(point.mean) + " MPa"],
      ["Change from starting recipe at same age", (delta > 0 ? "+" : "") + fmt(delta) + " MPa"],
      ["Explorer target · " + (point.mean >= filters.a.target ? "met" : "below target"), fmt(filters.a.target) + " MPa"]
    ]);
    $("recipe-ages").replaceChildren(...curve.map(row => {
      const tr = el("tr");
      if (row.selected) tr.className = "selected-age";
      for (const value of [row.age, fmt(row.mean), fmt(row.base), fmt(row.low) + "–" + fmt(row.high)]) {
        tr.append(el("td", value));
      }
      return tr;
    }));
    $("recipe-status").textContent = "";
    drawRecipe();
  } catch (error) {
    if (version === revision && !$("recipe-view").hidden) recipeStatus(error.message);
  }
}

function drawRecipe() {
  const canvas = $("recipe-plot");
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if ($("recipe-view").hidden || !w || !h) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  if (!curve.length) return;

  const left = 45, right = w - 23, top = 22, bottom = h - 48;
  const yAxis = niceAxis(0, Math.max(...curve.map(row => Math.max(row.high, row.base))), true);
  const px = age => left + (right - left) * age / 180;
  const py = strength => bottom - (bottom - top) * strength / yAxis.high;
  ctx.font = '13px "Segoe UI", sans-serif';
  ctx.fillStyle = "#53675f";
  ctx.strokeStyle = "#e2e8e3";
  ctx.textAlign = "right";
  for (let value = 0; value <= yAxis.high; value += yAxis.step) {
    ctx.fillText(String(value), left - 7, py(value) + 4);
    ctx.beginPath(); ctx.moveTo(left, py(value)); ctx.lineTo(right, py(value)); ctx.stroke();
  }
  ctx.textAlign = "center";
  const tickStep = w < 450 ? 60 : 30;
  for (let age = 0; age <= 180; age += tickStep) ctx.fillText(String(age), px(age), bottom + 19);
  ctx.fillText("Curing age (days)", (left + right) / 2, h - 6);

  function trace(key) {
    ctx.beginPath();
    curve.forEach((row, i) => {
      if (i === 0) ctx.moveTo(px(row.age), py(row[key]));
      else ctx.lineTo(px(row.age), py(row[key]));
    });
  }
  trace("high");
  for (let i = curve.length - 1; i >= 0; i--) ctx.lineTo(px(curve[i].age), py(curve[i].low));
  ctx.closePath(); ctx.fillStyle = "#d5e8d4"; ctx.fill();
  trace("mean"); ctx.lineWidth = 3; ctx.strokeStyle = "#145b50"; ctx.stroke();
  trace("base"); ctx.lineWidth = 1.6; ctx.strokeStyle = "#845731";
  ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  const current = curve.find(row => row.selected);
  ctx.beginPath(); ctx.arc(px(current.age), py(current.mean), 5, 0, 2 * Math.PI);
  ctx.fillStyle = "#145b50"; ctx.fill(); ctx.strokeStyle = "white"; ctx.stroke();
}

$("recipe-mode").onclick = () => openRecipe();
$("find-mode").onclick = () => { showFindView(); draw(); };
$("reset-recipe").onclick = () => { restoreRecipeInputs(); return refreshRecipe(); };
$("recipe-form").onsubmit = event => { event.preventDefault(); refreshRecipe(); };
$("recipe-form").oninput = () => {
  revision++;
  clearTimeout(timer);
  timer = setTimeout(() => { if (!$("recipe-view").hidden) refreshRecipe(); }, 120);
};
new ResizeObserver(drawRecipe).observe($("recipe-plot").parentElement);
