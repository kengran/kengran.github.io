"use strict";

const benchmark = window.blendedBenchmark;
const sizeControl = $("experiment-size");
const studyPlot = $("performance-plot");
let performancePoints = [];

function summarizeScores(runs, featureSet) {
  const mean = runs.reduce((sum, run) => sum + run[featureSet], 0) / runs.length;
  const squares = runs.reduce((sum, run) => sum + (run[featureSet] - mean) ** 2, 0);
  return {mean, sd: Math.sqrt(squares / (runs.length - 1))};
}

function setExperiment() {
  const learning = $("experiment").value === "learning";
  const records = benchmark[$("experiment").value];
  const sizes = [...new Set(records.map(row => row.x))].sort((a, b) => a - b);
  performancePoints = sizes.map(x => {
    const runs = records.filter(row => row.x === x);
    return {x, runs, basic: summarizeScores(runs, "basic"), chemistry: summarizeScores(runs, "chemistry")};
  });
  $("size-label").textContent = learning ? "Training measurements" : "Complex-blend examples added";
  $("performance-title").textContent = learning ? "Training size and chemistry" : "Learning complex blends";
  $("performance-caption").textContent = learning
    ? "Training size doubles at each step. Lower test error means closer agreement with measured strength. Select a point to inspect its splits."
    : "At zero, training uses " + count(benchmark.baseSize) + " simple-blend records. Each step adds examples with two or more supplementary materials. All test mixes are complex blends.";
  sizeControl.replaceChildren();
  for (const x of sizes) sizeControl.add(new Option(learning || x ? count(x) : "0 · Simple blends only", String(x)));
  sizeControl.value = String(learning ? sizes.at(-1) : 0);
  selectPerformancePoint();
}

function selectPerformancePoint() {
  const point = performancePoints.find(p => p.x === Number(sizeControl.value));
  const reduction = point.basic.mean - point.chemistry.mean;
  renderMetrics($("performance-metrics"), [
    ["Mix and test conditions", fmt(point.basic.mean, 2) + " MPa"],
    ["With binder chemistry", fmt(point.chemistry.mean, 2) + " MPa"],
    ["Mean error reduction", fmt(reduction, 2) + " MPa"]
  ]);
  const learning = $("experiment").value === "learning";
  $("split-title").textContent = learning ? "Held-out results · " + count(point.x) + " training rows"
    : "Held-out results · " + count(point.x) + " complex examples added";
  $("experiment-splits").replaceChildren(...point.runs.map(run => {
    const row = el("tr");
    for (const value of [run.seed + 1, count(run.train), count(run.test), count(run.papers),
      fmt(run.basic, 2), fmt(run.chemistry, 2), fmt(run.basic - run.chemistry, 2)]) {
      row.append(el("td", value));
    }
    return row;
  }));
  drawPerformance();
}

function svgShape(tag, attrs, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function drawPerformance() {
  if ($("performance-view").hidden || !performancePoints.length) return;
  const width = Math.max(280, $("performance-box").clientWidth);
  const height = $("performance-box").clientHeight || 320;
  const left = 56, right = width - 28, top = 24, bottom = height - 53;
  const spread = $("experiment-spread").checked;
  const learning = $("experiment").value === "learning";
  const keys = ["basic", "chemistry"];
  const scores = performancePoints.flatMap(p => keys.map(k => p[k]));
  const axis = niceAxis(Math.min(...scores.map(v => v.mean - v.sd)), Math.max(...scores.map(v => v.mean + v.sd)), false);
  const y = error => bottom - (error - axis.low) / (axis.high - axis.low) * (bottom - top);
  const transform = learning ? Math.log2 : x => x;
  const first = transform(performancePoints[0].x), last = transform(performancePoints.at(-1).x);
  const x = size => left + (transform(size) - first) / (last - first) * (right - left);
  const chosen = Number(sizeControl.value);
  studyPlot.setAttribute("viewBox", "0 0 " + width + " " + height);
  studyPlot.replaceChildren();
  const add = (tag, attrs, label) => studyPlot.append(svgShape(tag, attrs, label));
  const line = (x1, y1, x2, y2, stroke) => add("line", {x1, y1, x2, y2, stroke});
  const label = (px, py, anchor, title) => add("text", {x:px, y:py, "text-anchor":anchor}, title);
  for (let i = 0; i <= Math.round((axis.high - axis.low) / axis.step); i++) {
    const value = axis.low + i * axis.step;
    line(left, y(value), right, y(value), "#e2e8e3");
    label(left - 8, y(value) + 4, "end", Number(value.toFixed(2)));
  }
  add("text", {transform:"translate(16 "+(top+bottom)/2+") rotate(-90)", "text-anchor":"middle"}, "Test RMSE (MPa)");
  label((left + right) / 2, height - 7, "middle", learning ? "Training measurements" : "Complex-blend examples added");
  let priorLabel = -Infinity;
  for (const p of performancePoints) {
    if (x(p.x) - priorLabel > 31 || p === performancePoints.at(-1)) {
      label(x(p.x), bottom + 20, "middle", p.x >= 1000 ? p.x / 1000 + "k" : p.x);
      priorLabel = x(p.x);
    }
  }
  line(x(chosen), top, x(chosen), bottom, "#9caea5");
  for (const key of keys) {
    const basic = key === "basic", color = basic ? "#875731" : "#145b50";
    const xy = performancePoints.map(p => [x(p.x), y(p[key].mean)]);
    add("polyline", {points:xy.map(pair => pair.join(",")).join(" "), fill:"none",
      stroke:color, "stroke-width":2.5, "stroke-dasharray":basic ? "5 3" : "none"});
    performancePoints.forEach((p, i) => {
      const [px, py] = xy[i];
      if (spread) {
        const low = y(p[key].mean - p[key].sd), high = y(p[key].mean + p[key].sd);
        line(px, low, px, high, color);
        line(px-4, low, px+4, low, color);
        line(px-4, high, px+4, high, color);
      }
      add("circle", {cx:px, cy:py, r:p.x === chosen ? 5.5 : 3.5, stroke:color,
        "stroke-width":2, fill:basic ? "white" : color});
    });
  }
  performancePoints.forEach((p, i) => {
    const start = i ? (x(p.x) + x(performancePoints[i-1].x)) / 2 : left - 8;
    const end = i+1 < performancePoints.length ? (x(p.x) + x(performancePoints[i+1].x)) / 2 : right + 8;
    const target = svgShape("rect", {x:start, y:top, width:end-start, height:bottom-top+24, fill:"transparent", cursor:"pointer"});
    target.append(svgShape("title", {}, count(p.x) + (learning ? " training rows" : " complex examples added") +
      " · Mix RMSE " + fmt(p.basic.mean, 2) + " MPa · With chemistry " + fmt(p.chemistry.mean, 2) + " MPa"));
    target.onclick = () => { sizeControl.value = String(p.x); selectPerformancePoint(); };
    studyPlot.append(target);
  });
}

$("performance-mode").onclick = () => {
  $("find-view").hidden = true;
  $("performance-view").hidden = false;
  $("measure-mode").setAttribute("aria-pressed", "false");
  $("performance-mode").setAttribute("aria-pressed", "true");
  $("kind").textContent = "Local benchmark · Compressive strength";
  $("summary").textContent = "Compare strength prediction errors on papers held out from model training.";
  if (!benchmark) {
    $("performance-title").textContent = "Could not load benchmark results";
    $("performance-caption").textContent = "Check that data/blended-performance.js is present and refresh the page.";
    return;
  }
  $("benchmark-source").textContent = "These results come from a new local benchmark of " + count(benchmark.records) +
    " measurements across " + count(benchmark.papers) + " papers. It uses the cleaned CSV, excluding rows with unreported strength or added “Other SCM”. " +
    "Both feature sets use a " + benchmark.trees + "-tree random forest with a minimum of two samples per leaf and five repeated paper splits.";
  if (performancePoints.length) drawPerformance();
  else setExperiment();
};
$("measure-mode").onclick = () => { showFindView(); draw(); };
$("experiment").onchange = () => { if (benchmark) setExperiment(); };
sizeControl.onchange = selectPerformancePoint;
$("experiment-spread").onchange = drawPerformance;
new ResizeObserver(drawPerformance).observe($("performance-box"));
