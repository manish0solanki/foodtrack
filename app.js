'use strict';
/* FoodTrack — local-first calorie, nutrition and weight tracker. */
const KEY = 'foodtrack-v1';
const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r1 = n => Math.round(n * 10) / 10;
const fmt = n => Math.round(n).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
// Dates are local calendar days (not UTC), so a late-night snack lands on the right day.
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const niceDate = (s, long) => parseDay(s).toLocaleDateString(undefined, long ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });

const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
const GLASS_ML = 250;
// Daily water goal in glasses: about 33 ml per kg of body weight, kept between 1.5 and 4 litres. 2 litres until a weight is known.
function waterGoal() {
  const w = latestWeight() || (data.profile && data.profile.startWeight);
  if (!w) return 8;
  return Math.round(Math.min(4000, Math.max(1500, w * 33)) / GLASS_ML);
}
const litres = glasses => (glasses * GLASS_ML / 1000).toFixed(2).replace(/\.?0+$/, '');

/* ───────── data ───────── */
function normalise(d) {
  d = d && typeof d === 'object' ? d : {};
  d.days = d.days && typeof d.days === 'object' ? d.days : {};
  for (const k in d.days) {
    const day = d.days[k] || (d.days[k] = {});
    day.meals = Array.isArray(day.meals) ? day.meals : [];
    day.water = num(day.water);
    day.steps = Math.max(0, Math.round(num(day.steps)));
    day.meals.forEach(m => { if (!MEALS.some(x => x[0] === m.meal)) m.meal = 'snack'; });
  }
  const byDate = {};
  (Array.isArray(d.weights) ? d.weights : []).forEach(w => { if (w && w.date && num(w.kg) > 0) byDate[w.date] = r1(num(w.kg)); });
  d.weights = Object.keys(byDate).sort().map(date => ({ date, kg: byDate[date] }));
  d.recents = Array.isArray(d.recents) ? d.recents : [];
  d.profile = d.profile && typeof d.profile === 'object' ? d.profile : null;
  d.target = num(d.target) || 1800;
  d.manualTarget = num(d.manualTarget) || null;
  d.adaptive = d.adaptive !== false;
  d.stepGoal = Math.round(num(d.stepGoal)) || null;
  d.eatBack = d.eatBack === true;
  const pf = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
  d.prefs = { diet: ['veg', 'egg', 'nonveg'].includes(pf.diet) ? pf.diet : 'veg', avoid: Array.isArray(pf.avoid) ? pf.avoid : [], dislikes: String(pf.dislikes || '') };
  d.savedMeals = Array.isArray(d.savedMeals) ? d.savedMeals.filter(m => m && m.name && Array.isArray(m.items)) : [];
  return d;
}
let data;
try { data = normalise(JSON.parse(localStorage.getItem(KEY))); } catch (e) { data = normalise(null); }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { toast('Could not save — storage is full or blocked.'); }
  render();
}
const getDay = d => data.days[d] || { meals: [], water: 0, steps: 0 };
const mutDay = d => data.days[d] || (data.days[d] = { meals: [], water: 0, steps: 0 });
const totals = meals => meals.reduce((a, m) => { for (const k of ['cal', 'protein', 'carbs', 'fat', 'fiber']) a[k] += num(m[k]); return a; }, { cal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
const latestWeight = () => data.weights.length ? data.weights[data.weights.length - 1].kg : null;

/* ───────── plan maths ───────── */
// Works out what the body really burns from the last 4 weeks of logs:
// burn = average calories eaten − (weight change per day × 7700 kcal per kg).
// Needs 14+ days between first and last weigh-in, 4+ weigh-ins and 10+ fully logged days.
function measuredBurn(bmr) {
  const t = todayStr(), ws = data.weights.filter(w => w.date >= addDays(t, -28) && w.date <= t);
  const out = { ready: false, weighIns: ws.length, days: 0, span: 0 };
  if (ws.length < 2) return out;
  const first = ws[0].date, last = ws[ws.length - 1].date, dayNo = d => Math.round((parseDay(d) - parseDay(first)) / 864e5);
  out.span = dayNo(last);
  const full = Math.max(800, 0.6 * bmr);            // ignore days that look only partly logged
  let eaten = 0;
  for (let d = first; d < last; d = addDays(d, 1)) { const c = totals(getDay(d).meals).cal; if (c >= full) { eaten += c; out.days++; } }
  if (out.span < 14 || ws.length < 4 || out.days < Math.max(10, 0.6 * out.span)) return out;
  // least-squares trend line through the weigh-ins, so one odd reading does not swing the result
  const n = ws.length, xs = ws.map(w => dayNo(w.date)), mx = xs.reduce((a, b) => a + b) / n, my = ws.reduce((a, w) => a + w.kg, 0) / n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ws[i].kg - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  out.intake = eaten / out.days; out.weekly = slope * 7; out.tdee = out.intake - slope * 7700; out.ready = true;
  return out;
}
function plan() {
  const p = data.profile, w = latestWeight() || (p && p.startWeight);
  const r = { cal: data.manualTarget || data.target, auto: false };
  if (p && w) {
    const bmr = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
    const formulaTdee = bmr * p.activity, floor = p.sex === 'm' ? 1500 : 1200, m = measuredBurn(bmr);
    let tdee = formulaTdee;
    if (data.adaptive && m.ready) {
      // Trust the measurement more as data builds up, and never stray more than 25% from the formula.
      const trust = m.span >= 21 ? 0.75 : 0.5, measured = Math.min(formulaTdee * 1.25, Math.max(formulaTdee * 0.75, m.tdee));
      tdee = formulaTdee * (1 - trust) + measured * trust;
    }
    const losing = p.goal < w - 0.05;
    const want = losing ? tdee - p.pace * 1100 : tdee;      // 7700 kcal ≈ 1 kg → 1100 kcal/day per kg/week
    const autoCal = Math.round(Math.max(floor, want) / 10) * 10;
    Object.assign(r, { auto: true, bmr, tdee, formulaTdee, measured: m, adapted: tdee !== formulaTdee, losing, floor, floored: want < floor, autoCal, weight: w, bmi: w / (p.height / 100) ** 2 });
    if (!data.manualTarget) r.cal = autoCal;
    r.weekly = Math.max(0, (tdee - r.cal) * 7 / 7700);
    r.weeks = losing && r.weekly > 0.02 ? (w - p.goal) / r.weekly : null;
  }
  const basis = p && w ? (r.losing ? p.goal : w) : null;
  r.protein = Math.round(basis ? Math.min(1.6 * basis, r.cal * 0.35 / 4) : r.cal * 0.25 / 4);
  r.fat = Math.round(r.cal * 0.28 / 9);
  r.carbs = Math.max(0, Math.round((r.cal - r.protein * 4 - r.fat * 9) / 4));
  r.fiber = Math.max(25, Math.round(r.cal * 14 / 1000));
  return r;
}

/* ───────── steps ───────── */
// The calorie target already assumes some daily movement for the chosen activity level, so only steps beyond
// that baseline count as extra burn. Walking uses roughly 0.5 kcal per kg of body weight per 1,000 steps.
const STEP_BASE = { 1.2: 3000, 1.375: 5000, 1.55: 7500, 1.725: 10000 };
function stepInfo(date) {
  const pr = data.profile, kg = latestWeight() || (pr && pr.startWeight) || 70, steps = num(getDay(date).steps);
  const base = (pr && STEP_BASE[pr.activity]) || 5000, perStep = 0.0005 * kg;
  const goal = data.stepGoal || Math.max(8000, base + 3000);
  return { steps, base, goal, perStep, burned: steps * perStep, extra: Math.max(0, steps - base) * perStep, km: steps * (pr ? pr.height * 0.00415 : 0.72) / 1000 };
}
// Calories allowed on a day: the plan's target, plus half of the extra step calories if the person chose that.
const stepBonus = date => data.eatBack ? Math.round(stepInfo(date).extra / 2 / 10) * 10 : 0;

/* ───────── state ───────── */
let cur = todayStr(), tab = 'today', shown = [], sheetFood = null, sheetMeal = null, remote = null;
let meal = (() => { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 18 ? 'snack' : h < 23 ? 'dinner' : 'snack'; })();

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ───────── render: today ───────── */
function render() { renderHeader(); renderToday(); renderProgress(); renderPlan(); }

function renderHeader() {
  const t = todayStr();
  $('dateLabel').textContent = cur === t ? 'Today' : cur === addDays(t, -1) ? 'Yesterday' : niceDate(cur);
  $('nextDay').disabled = cur >= t;
}

function ringSvg(frac, over) {
  const R = 44, C = 2 * Math.PI * R, f = Math.max(0, Math.min(1, frac));
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--line)" stroke-width="9"/>
    <circle cx="50" cy="50" r="${R}" fill="none" stroke="${over ? 'var(--over)' : 'var(--accent)'}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${f * C} ${C}" transform="rotate(-90 50 50)"/></svg>`;
}

function coachTip(s, p, isToday) {
  if (!s.cal) return isToday ? 'Log your first meal — tracking everything you eat is the single most effective weight-loss habit.' : '';
  const left = p.cal - s.cal;
  if (left < -50) return `⚠️ ${fmt(-left)} kcal over target. One day won’t undo your progress — just get back on plan with the next meal.`;
  if (s.cal / p.cal > 0.5 && s.protein / p.protein < s.cal / p.cal - 0.2)
    return `💪 Protein is lagging (${fmt(s.protein)} of ${p.protein} g). It keeps you full and protects muscle — try eggs, dal, paneer, curd, chicken or soya.`;
  if (left <= 150) return '✅ Right on target for the day. Nicely done.';
  if (s.cal / p.cal > 0.6 && s.fiber < p.fiber * 0.4) return `🥦 Low on fiber so far (${fmt(s.fiber)} of ${p.fiber} g). Vegetables, fruit, dal and whole grains fill you up for few calories.`;
  return `${fmt(left)} kcal left ${isToday ? 'for today' : 'that day'}.`;
}

function renderToday() {
  const d = getDay(cur), s = totals(d.meals), p = plan(), bonus = stepBonus(cur);
  p.cal += bonus;                                   // p is a fresh object, so this only affects today's view
  const left = p.cal - s.cal;
  $('setupBanner').hidden = !!data.profile;
  $('ring').innerHTML = ringSvg(s.cal / p.cal, left < 0) +
    `<div class="mid"><b>${fmt(Math.abs(left))}</b><span>${left < 0 ? 'kcal over' : 'kcal left'}</span></div>`;
  $('consumed').textContent = fmt(s.cal);
  $('target').textContent = fmt(p.cal);
  $('target').nextElementSibling.textContent = bonus ? `target (incl. +${bonus} from steps)` : 'target';
  $('macros').innerHTML = [['Protein', 'protein'], ['Carbs', 'carbs'], ['Fat', 'fat'], ['Fiber', 'fiber']].map(([label, k]) =>
    `<div class="macro"><b>${fmt(s[k])}</b> <span>/ ${p[k]} g</span><div class="track"><i style="width:${Math.min(100, s[k] / p[k] * 100)}%"></i></div><span>${label}</span></div>`).join('');
  $('tip').textContent = coachTip(s, p, cur === todayStr());

  const wGoal = waterGoal(), hasWeight = !!(latestWeight() || (data.profile && data.profile.startWeight));
  $('waterCount').textContent = `${litres(d.water)} / ${litres(wGoal)} L`;
  $('waterNote').textContent = `One tap = one ${GLASS_ML} ml glass. ` + (hasWeight ? 'Goal is based on your weight (about 33 ml per kg).' : 'Goal is a standard 2 litres until you set up your plan or log a weight.');
  $('waterMinus').disabled = d.water <= 0;
  const st = stepInfo(cur), isToday = cur === todayStr();
  $('stepCount').textContent = `${fmt(st.steps)} / ${fmt(st.goal)}`;
  $('stepBar').style.width = Math.min(100, st.steps / st.goal * 100) + '%';
  $('stepIn').placeholder = isToday ? 'Steps today' : 'Steps that day';
  let note;
  if (!st.steps) note = `Type in the step count from your phone’s health app or watch — this site cannot read it by itself. Every 2,000 extra steps (about 20 minutes of walking) burns roughly ${fmt(2000 * st.perStep)} kcal.`;
  else {
    note = `≈ ${fmt(st.burned)} kcal burned walking (${st.km.toFixed(1)} km). `;
    note += st.extra >= 1 ? `${fmt(st.extra)} kcal of that is beyond your usual activity — ${bonus ? `${bonus} kcal is added to today’s food budget` : 'extra fat loss on top of your plan'}. `
      : `${fmt(st.base - st.steps)} more steps to pass your usual level of ${fmt(st.base)}. `;
    note += st.steps >= st.goal ? '🎉 Goal reached.' : `${fmt(st.goal - st.steps)} steps to your goal — about ${Math.ceil((st.goal - st.steps) / 100)} minutes of walking.`;
  }
  $('stepNote').textContent = note;
  $('stepBaseNote').textContent = `Your calorie target already assumes about ${fmt(st.base)} steps a day for your activity level, so only steps beyond that count as extra.`;
  $('stepGoalIn').placeholder = `New goal (now ${fmt(st.goal)})`;
  $('eatBack').checked = data.eatBack;

  $('waterDots').innerHTML = Array.from({ length: Math.max(wGoal, d.water) }, (_, i) => `<i class="${i < d.water ? 'on' : ''}"></i>`).join('');

  $('mealChips').innerHTML = chips(meal);
  renderResults();
  renderIdeas();

  const y = getDay(addDays(cur, -1));
  $('copyYesterday').hidden = !(d.meals.length === 0 && y.meals.length);
  $('meals').innerHTML = d.meals.length ? MEALS.map(([k, label]) => {
    const list = d.meals.map((m, i) => [m, i]).filter(([m]) => m.meal === k);
    if (!list.length) return '';
    return `<div class="mealhead"><span class="mh">${label}<button class="secondary small" data-savemeal="${k}">⭐ Save meal</button></span><span>${fmt(totals(list.map(x => x[0])).cal)} kcal</span></div>` + list.map(([m, i]) =>
      `<div class="item"><div class="txt tap" data-edit="${i}" role="button" tabindex="0" aria-label="Edit ${esc(m.name)}"><b>${esc(m.name)}</b><br><small>${m.note ? esc(m.note) + ' · ' : ''}P ${r1(num(m.protein))} · C ${r1(num(m.carbs))} · F ${r1(num(m.fat))} g</small></div>
       <span class="kc">${fmt(num(m.cal))} kcal</span><button class="secondary icon" data-del="${i}" aria-label="Remove ${esc(m.name)}">×</button></div>`).join('');
  }).join('') : `<p class="muted">Nothing logged ${cur === todayStr() ? 'yet today' : 'on this day'}.</p>`;
}

const chips = on => MEALS.map(([k, label]) => `<button data-meal="${k}" class="${k === on ? 'on' : ''}">${label}</button>`).join('');

/* ───────── food search ───────── */
const foodLine = f => `${fmt(f.cal)} kcal · P ${r1(f.protein)} · C ${r1(f.carbs)} · F ${r1(f.fat)} g`;
function renderResults() {
  const q = $('q').value.trim().toLowerCase();
  let html = '';
  shown = [];
  const row = f => { shown.push(f); return `<button class="item pick" data-i="${shown.length - 1}"><span class="txt"><b>${esc(f.name)}</b><br><small>${esc(f.serving)} · ${foodLine(f)}</small></span><span class="kc">＋</span></button>`; };
  const savedRow = ([m, i]) => `<div class="item"><button class="item pick" data-sm="${i}"><span class="txt"><b>⭐ ${esc(m.name)}</b><br><small>${m.items.length} item${m.items.length > 1 ? 's' : ''} · ${fmt(totals(m.items).cal)} kcal · adds to ${MEALS.find(x => x[0] === meal)[1]}</small></span><span class="kc">＋</span></button><button class="secondary icon" data-smdel="${i}" aria-label="Delete saved meal ${esc(m.name)}">×</button></div>`;
  const saved = data.savedMeals.map((m, i) => [m, i]).filter(([m]) => !q || q.split(/\s+/).every(w => m.name.toLowerCase().includes(w)));
  if (!q) {
    if (saved.length) html = '<p class="listhead">Saved meals</p>' + saved.slice(0, 8).map(savedRow).join('');
    if (data.recents.length) html += '<p class="listhead">Recent</p>' + data.recents.slice(0, 6).map(row).join('');
  } else {
    html = saved.slice(0, 4).map(savedRow).join('');
    const words = q.split(/\s+/), hit = f => words.every(w => (f.keys || f.name.toLowerCase()).includes(w));
    const seen = new Set();
    const rank = f => { const n = f.name.toLowerCase(); return n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2; };   // name matches before alias matches
    const local = data.recents.concat(FOODS).filter(f => hit(f) && !seen.has(f.name + '|' + f.serving) && seen.add(f.name + '|' + f.serving))
      .map((f, i) => [f, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).slice(0, 12).map(x => x[0]);
    html += local.map(row).join('');
    if (remote && remote.q === q) {
      html += '<p class="listhead">Packaged foods (Open Food Facts)</p>' +
        (remote.loading ? '<p class="muted">Searching…</p>' : remote.error ? `<p class="muted">${esc(remote.error)}</p><button class="secondary linkbtn" id="onlineBtn">Try again</button>` : remote.items.map(row).join('') || '<p class="muted">No packaged foods found.</p>');
    } else {
      const barcode = /^\d{8,14}$/.test(q);
      if (!local.length && !saved.length && !barcode) html += '<p class="muted">Not in the built-in list.</p>';
      html += `<button class="secondary linkbtn" id="onlineBtn">${barcode ? '🔎 Look up barcode ' + esc(q) : '🌐 Search packaged foods online'}</button>`;
    }
  }
  $('results').innerHTML = html;
}

const OFF = 'https://world.openfoodfacts.org';
const OFF_FIELDS = 'product_name,brands,nutriments,serving_quantity';
function offFood(p) {
  const n = (p && p.nutriments) || {};
  let cal = n['energy-kcal_100g'];
  const kj = n['energy-kj_100g'] ?? n.energy_100g;
  if (cal == null && kj != null) cal = kj / 4.184;
  if (!p || !p.product_name || cal == null || !isFinite(+cal)) return null;   // skip products with no calorie data
  const brand = (p.brands || '').split(',')[0].trim();
  return { name: p.product_name.trim() + (brand ? ` (${brand})` : ''), serving: '100 g', per100: true, defG: num(p.serving_quantity) || 100,
    cal: +cal, protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g), fat: num(n.fat_100g), fiber: num(n.fiber_100g) };
}
async function getJson(url, tries = 3) {
  // Open Food Facts is a free service that is sometimes slow or busy, so retry before giving up.
  for (let i = 1; ; i++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000);
    try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok && r.status !== 404) throw new Error(r.status); return await r.json(); }
    catch (e) { if (i >= tries) throw e; await new Promise(ok => setTimeout(ok, 1500)); }
    finally { clearTimeout(t); }
  }
}
async function searchOnline() {
  const q = $('q').value.trim().toLowerCase();
  if (!q) return;
  if (/^\d{8,14}$/.test(q)) return lookupBarcode(q);
  const mine = remote = { q, loading: true };
  renderResults();
  try {
    const j = await getJson(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`);
    mine.items = (j.products || []).map(offFood).filter(Boolean).slice(0, 12);
  } catch (e) { mine.error = 'Open Food Facts did not respond — it is a free service and is sometimes busy. Wait a few seconds and try again, or use “Custom food”.'; mine.retry = true; }
  mine.loading = false;
  if (remote === mine) renderResults();
}
async function lookupBarcode(code) {
  toast('Looking up barcode…');
  try {
    const j = await getJson(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
    const f = offFood(j.product);
    if (f) openSheet(f); else toast('No nutrition data found for that barcode. Use “Custom food” instead.');
  } catch (e) { toast('Could not reach Open Food Facts. Try again.'); }
}

/* ───────── portion sheet ───────── */
function openSheet(f) {
  sheetFood = f; sheetMeal = meal;
  $('shName').textContent = f.name;
  $('shPer').textContent = `${f.serving}: ${foodLine(f)}`;
  $('shQty').value = f.per100 ? (f.lastQty || f.defG || 100) : (f.lastQty || 1);
  $('shUnit').textContent = f.per100 ? 'grams' : '× ' + f.serving;
  renderSheet();
  $('sheet').showModal();
}
function sheetValues() {
  const f = sheetFood, q = Math.max(0, num($('shQty').value)), k = f.per100 ? q / 100 : q;
  return { q, cal: f.cal * k, protein: f.protein * k, carbs: f.carbs * k, fat: f.fat * k, fiber: f.fiber * k };
}
function renderSheet() {
  const v = sheetValues();
  $('shMeals').innerHTML = chips(sheetMeal);
  $('shTotals').innerHTML = `<div><b>${fmt(v.cal)}</b><span class="muted small">kcal</span></div><div><b>${r1(v.protein)} g</b><span class="muted small">Protein</span></div><div><b>${r1(v.carbs)} g</b><span class="muted small">Carbs</span></div><div><b>${r1(v.fat)} g</b><span class="muted small">Fat</span></div>`;
  $('shAdd').disabled = v.q <= 0;
}
function stepQty(dir) {
  const step = sheetFood.per100 ? 10 : 0.5;
  $('shQty').value = r1(Math.max(step, num($('shQty').value) + dir * step));
  renderSheet();
}
function addFromSheet() {
  const f = sheetFood, v = sheetValues();
  if (v.q <= 0) return;
  mutDay(cur).meals.push({ name: f.name, meal: sheetMeal, note: f.per100 ? `${r1(v.q)} g` : `${r1(v.q)} × ${f.serving}`,
    cal: Math.round(v.cal), protein: r1(v.protein), carbs: r1(v.carbs), fat: r1(v.fat), fiber: r1(v.fiber) });
  const { keys, ...rec } = f;
  rec.lastQty = v.q;
  data.recents = [rec].concat(data.recents.filter(x => !(x.name === f.name && x.serving === f.serving))).slice(0, 30);
  meal = sheetMeal; remote = null; $('q').value = '';
  $('sheet').close(); save();
  toast(`Added ${f.name}`);
}

/* ───────── barcode scanner ───────── */
let scanStream = null, scanTimer = null;
async function openScanner() {
  $('scanMsg').textContent = 'Point the camera at the barcode on the pack.';
  $('scanDlg').showModal();
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = $('scanVideo'); v.srcObject = scanStream;
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = v.readyState >= 2 ? await det.detect(v) : [];
        if (codes.length) { const code = codes[0].rawValue; $('scanDlg').close(); return lookupBarcode(code); }
      } catch (e) { /* frame not ready */ }
      scanTimer = setTimeout(tick, 300);
    };
    tick();
  } catch (e) { $('scanMsg').textContent = 'Camera unavailable or permission denied. You can type the barcode number into the search box instead.'; }
}
function stopScanner() {
  clearTimeout(scanTimer);
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  scanStream = null; $('scanVideo').srcObject = null;
}

/* ───────── render: progress ───────── */
function tooltip(el, x, y, text) {
  let t = el.querySelector('.tt');
  if (text == null) { if (t) t.remove(); return; }
  if (!t) { t = document.createElement('div'); t.className = 'tt'; el.appendChild(t); }
  t.textContent = text;
  const half = t.offsetWidth / 2, W = el.clientWidth;
  t.style.left = Math.max(half, Math.min(W - half, x)) + 'px';
  t.style.top = Math.max(30, y - 10) + 'px';
}

function weightChart(el) {
  const pts = data.weights.slice(-90).map(w => ({ t: parseDay(w.date).getTime(), kg: w.kg, date: w.date }));
  if (pts.length < 2) { el.innerHTML = '<p class="muted small">Log your weight on two or more days to see your trend here. Weigh in at the same time each day — mornings are best.</p>'; return; }
  const W = el.clientWidth || 320, H = 210, m = { l: 40, r: 16, t: 18, b: 24 };
  let lo = Math.min(...pts.map(p => p.kg)), hi = Math.max(...pts.map(p => p.kg));
  const goal = data.profile && data.profile.goal, showGoal = goal && lo - goal <= Math.max(5, 2 * (hi - lo)) && goal - hi <= 5;
  if (showGoal) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  const padY = Math.max(0.5, (hi - lo) * 0.15); lo -= padY; hi += padY;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = t => m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r), y = k => m.t + (hi - k) / (hi - lo) * (H - m.t - m.b);
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="Weight over time">`;
  for (let i = 0; i <= 3; i++) { const k = lo + (hi - lo) * i / 3; s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(k)}" y2="${y(k)}"/><text x="${m.l - 6}" y="${y(k) + 4}" text-anchor="end">${k.toFixed(1)}</text>`; }
  if (showGoal) s += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${y(goal)}" y2="${y(goal)}"/><text x="${m.l + 4}" y="${y(goal) - 5}">Goal ${goal} kg</text>`;
  s += `<path class="ln" d="${pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.kg).toFixed(1)).join('')}"/>`;
  if (pts.length <= 31) s += pts.map(p => `<circle class="pt" cx="${x(p.t)}" cy="${y(p.kg)}" r="4"/>`).join('');
  const last = pts[pts.length - 1];
  s += `<circle class="pt" cx="${x(last.t)}" cy="${y(last.kg)}" r="5"/><text class="lab" x="${x(last.t) + 4}" y="${last.kg <= pts[pts.length - 2].kg ? y(last.kg) + 18 : y(last.kg) - 10}" text-anchor="end">${last.kg} kg</text>`;
  s += `<text x="${m.l}" y="${H - 6}">${niceDate(pts[0].date, true)}</text><text x="${W - m.r}" y="${H - 6}" text-anchor="end">${niceDate(last.date, true)}</text>`;
  s += `<line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/></svg>`;
  el.innerHTML = s;
  const svg = el.firstChild, cross = svg.querySelector('.cross');
  svg.onpointermove = e => {
    const px = e.clientX - svg.getBoundingClientRect().left;
    const p = pts.reduce((a, b) => Math.abs(x(b.t) - px) < Math.abs(x(a.t) - px) ? b : a);
    cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.setAttribute('visibility', 'visible');
    tooltip(el, x(p.t), y(p.kg), `${niceDate(p.date)} · ${p.kg} kg`);
  };
  svg.onpointerleave = () => { cross.setAttribute('visibility', 'hidden'); tooltip(el); };
}

function calChart(el, days, target, unit = 'kcal', refLabel = 'Target') {
  const W = el.clientWidth || 320, H = 190, m = { l: 40, r: 8, t: 16, b: 24 };
  const max = Math.max(target * 1.15, ...days.map(d => d.cal)) || 1;
  const bw = (W - m.l - m.r) / days.length, y = c => m.t + (1 - c / max) * (H - m.t - m.b), base = H - m.b;
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="${unit === 'kcal' ? 'Calories eaten' : 'Steps'} per day against ${refLabel.toLowerCase()}">`;
  for (const c of [0, max / 2, max]) s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(c)}" y2="${y(c)}"/><text x="${m.l - 6}" y="${y(c) + 4}" text-anchor="end">${fmt(c)}</text>`;
  days.forEach((d, i) => {
    const x0 = m.l + i * bw + 1, w = Math.max(2, bw - 2), top = y(d.cal), r = Math.min(4, w / 2, base - top);
    if (d.cal > 0) s += `<path class="bar${d.date === cur ? '' : ' dim'}" d="M${x0} ${base}V${top + r}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}V${base}z"/>`;
    if (i % 2 === (days.length - 1) % 2) s += `<text x="${x0 + w / 2}" y="${H - 6}" text-anchor="middle">${parseDay(d.date).getDate()}</text>`;
    s += `<rect data-i="${i}" x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${base - m.t}" fill="transparent"/>`;
  });
  s += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${y(target)}" y2="${y(target)}"/><text x="${W - m.r}" y="${y(target) - 5}" text-anchor="end">${refLabel} ${fmt(target)}</text></svg>`;
  el.innerHTML = s;
  const svg = el.firstChild;
  svg.onpointermove = e => {
    const i = e.target.dataset && e.target.dataset.i; if (i == null) return tooltip(el);
    const d = days[i], diff = d.cal - target;
    tooltip(el, m.l + (+i + 0.5) * bw, y(d.cal), d.cal ? `${niceDate(d.date)} · ${fmt(d.cal)} ${unit} (${fmt(Math.abs(diff))} ${diff > 0 ? 'over' : 'under'})` : `${niceDate(d.date)} · nothing logged`);
  };
  svg.onpointerleave = () => tooltip(el);
}

const tile = (v, label) => `<div class="tile"><b>${v}</b><span>${label}</span></div>`;
function renderProgress() {
  if (tab !== 'progress') return;
  const p = plan(), pr = data.profile, ws = data.weights, w = latestWeight();
  $('weightFor').textContent = `Saving for ${cur === todayStr() ? 'today' : niceDate(cur)}. Change the day with the arrows at the top.`;
  const start = pr && pr.startWeight || (ws[0] && ws[0].kg);
  let tiles = '';
  if (w) {
    const ch = w - start;
    tiles += tile(w + ' kg', 'Current') + tile((ch > 0 ? '+' : ch < 0 ? '−' : '') + r1(Math.abs(ch)) + ' kg', 'Since start');
    if (pr) tiles += tile(w > pr.goal ? r1(w - pr.goal) + ' kg' : '🎉 Reached', 'To goal') + tile(p.bmi.toFixed(1), 'BMI');
  }
  $('weightTiles').innerHTML = tiles;
  weightChart($('weightChart'));

  let proj = '';
  if (pr && p.weeks) {
    const eta = new Date(); eta.setDate(eta.getDate() + Math.round(p.weeks * 7));
    proj = `At about ${r1(p.weekly)} kg per week you would reach ${pr.goal} kg around ${eta.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`;
  }
  const recent = ws.filter(x => x.date >= addDays(todayStr(), -28));
  if (recent.length >= 2) {
    const span = (parseDay(recent[recent.length - 1].date) - parseDay(recent[0].date)) / 864e5;
    if (span >= 7) { const rate = (recent[recent.length - 1].kg - recent[0].kg) / span * 7; proj += ` Your actual trend over the last ${Math.round(span)} days: ${rate > 0 ? '+' : '−'}${r1(Math.abs(rate))} kg per week.`; }
  }
  $('projection').textContent = proj.trim();
  $('weightList').innerHTML = ws.slice().reverse().slice(0, 5).map(x =>
    `<div class="item"><span class="txt">${niceDate(x.date, true)}</span><b>${x.kg} kg</b><button class="secondary icon" data-delw="${x.date}" aria-label="Delete weight for ${x.date}">×</button></div>`).join('');

  const t = todayStr(), days = Array.from({ length: 14 }, (_, i) => { const date = addDays(t, i - 13); return { date, cal: totals(getDay(date).meals).cal }; });
  const logged = days.filter(d => d.cal > 0);
  let streak = 0;
  for (let d = getDay(t).meals.length ? t : addDays(t, -1); getDay(d).meals.length; d = addDays(d, -1)) streak++;
  $('calTiles').innerHTML = logged.length ? tile(fmt(logged.reduce((a, d) => a + d.cal, 0) / logged.length), 'Daily average') +
    tile(`${logged.filter(d => d.cal <= (p.cal + stepBonus(d.date)) * 1.05).length} / ${logged.length}`, 'Days on target') +
    tile(logged.length, 'Days logged') + tile(streak + (streak === 1 ? ' day' : ' days'), 'Logging streak') : '';
  if (logged.length) calChart($('calChart'), days, p.cal);
  else $('calChart').innerHTML = '<p class="muted small">Log some meals and your daily calories will show up here against your target.</p>';
  const sDays = days.map(d => ({ date: d.date, cal: num(getDay(d.date).steps) })), sLogged = sDays.filter(d => d.cal > 0), sg = stepInfo(t);
  $('stepTiles').innerHTML = sLogged.length ? tile(fmt(sLogged.reduce((a, d) => a + d.cal, 0) / sLogged.length), 'Daily average') + tile(fmt(Math.max(...sLogged.map(d => d.cal))), 'Best day') +
    tile(`${sLogged.filter(d => d.cal >= sg.goal).length} / ${sLogged.length}`, 'Days at goal') + tile(fmt(sLogged.reduce((a, d) => a + d.cal, 0) * sg.perStep), 'kcal walked') : '';
  if (sLogged.length) calChart($('stepChart'), sDays, sg.goal, 'steps', 'Goal');
  else $('stepChart').innerHTML = '<p class="muted small">Save your steps on the Today tab and they will show up here against your goal.</p>';
}

/* ───────── render: plan ───────── */
let planFormFilled = false;
function renderPlan() {
  const pr = data.profile, p = plan();
  if (!planFormFilled) {
    planFormFilled = true;
    if (pr) { $('pSex').value = pr.sex; $('pAge').value = pr.age; $('pHeight').value = pr.height; $('pGoal').value = pr.goal; $('pPace').value = pr.pace; $('pActivity').value = pr.activity; }
    $('pWeight').value = latestWeight() || '';
  }
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  let h = kv('Daily calorie target', fmt(p.cal) + ' kcal' + (data.manualTarget ? ' (custom)' : ''));
  if (p.auto) {
    h += kv('Calories you burn per day' + (p.adapted ? ' (from your results)' : ''), fmt(p.tdee) + ' kcal') + kv('Resting metabolism (BMR)', fmt(p.bmr) + ' kcal') +
      kv('Daily deficit', fmt(Math.max(0, p.tdee - p.cal)) + ' kcal') + kv('Expected loss', r1(p.weekly) + ' kg / week');
    if (p.weeks) h += kv('Time to goal', p.weeks < 8 ? `about ${Math.max(1, Math.round(p.weeks))} weeks` : `about ${Math.round(p.weeks / 4.345)} months`);
    const hm = (pr.height / 100) ** 2;
    h += kv('BMI', `${p.bmi.toFixed(1)} (healthy range ${Math.round(18.5 * hm)}–${Math.round(24.9 * hm)} kg)`);
  }
  h += kv('Protein / Carbs / Fat', `${p.protein} / ${p.carbs} / ${p.fat} g`) + kv('Fiber', `${p.fiber} g`);
  if (!p.auto) h += '<div class="note">Fill in the form above to get a target calculated for your body and goal.</div>';
  else {
    const m = p.measured;
    if (p.adapted) h += `<div class="note">📈 <b>Adjusted from your results.</b> Over ${m.span} days you ate about ${fmt(m.intake)} kcal a day and your weight ${Math.abs(m.weekly) < 0.05 ? 'stayed level' : (m.weekly < 0 ? 'fell' : 'rose') + ' by ' + r1(Math.abs(m.weekly)) + ' kg a week'}, which means you burn about ${fmt(m.tdee)} kcal a day. The standard formula alone says ${fmt(p.formulaTdee)}. This is only as accurate as your logging.</div>`;
    else if (data.adaptive) h += `<div class="note">📈 <b>Self-adjusting target.</b> Once there is enough data, your target is tuned from what you really eat and weigh. In the last 4 weeks you have ${m.weighIns} of 4 weigh-ins (spread over ${m.span} of 14 days) and ${m.days} of 10 fully logged days.</div>`;
    if (p.floored && !data.manualTarget) h += `<div class="note">Your chosen pace would need fewer than ${p.floor} kcal a day, which is too low to eat well. The target is held at ${p.floor} kcal, so expect about ${r1(p.weekly)} kg per week — or raise your activity level.</div>`;
    if (data.manualTarget && data.manualTarget < p.floor) h += `<div class="note">⚠️ A custom target under ${p.floor} kcal is very low. Diets this low should only be followed with medical supervision.</div>`;
    if (pr.goal / (pr.height / 100) ** 2 < 18.5) h += '<div class="note">⚠️ Your goal weight is below the healthy BMI range for your height. Consider a higher goal.</div>';
    if (!p.losing) h += '<div class="note">You are at or below your goal weight — this target maintains your current weight.</div>';
  }
  $('planOut').innerHTML = h;
  $('manualClear').hidden = !(data.manualTarget && p.auto);
  $('adaptiveOn').checked = data.adaptive;
}

function savePlan() {
  const v = { sex: $('pSex').value, age: num($('pAge').value), height: num($('pHeight').value), goal: num($('pGoal').value), pace: num($('pPace').value), activity: num($('pActivity').value) };
  const w = num($('pWeight').value);
  if (v.age < 15 || v.age > 100) return toast('Enter an age between 15 and 100.');
  if (v.height < 120 || v.height > 230) return toast('Enter your height in cm (120–230).');
  if (w < 30 || w > 300) return toast('Enter your current weight in kg.');
  if (v.goal < 30 || v.goal > 300) return toast('Enter your goal weight in kg.');
  const old = data.profile;
  v.startWeight = old && old.startWeight ? old.startWeight : w;
  v.startDate = old && old.startDate ? old.startDate : todayStr();
  data.profile = v;
  setWeight(todayStr(), w);
  save(); toast('Plan saved — your daily target is ' + fmt(plan().cal) + ' kcal.');
}
function setWeight(date, kg) {
  data.weights = data.weights.filter(x => x.date !== date).concat({ date, kg: r1(kg) }).sort((a, b) => a.date < b.date ? -1 : 1);
}

/* ───────── events ───────── */
function setTab(t) {
  tab = t;
  for (const v of ['today', 'progress', 'plan']) $('view-' + v).hidden = v !== t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  window.scrollTo(0, 0); render();
}
document.querySelector('.tabs').onclick = e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
$('setupBtn').onclick = () => setTab('plan');
$('prevDay').onclick = () => { cur = addDays(cur, -1); render(); };
$('nextDay').onclick = () => { if (cur < todayStr()) { cur = addDays(cur, 1); render(); } };
$('dateLabel').onclick = () => { cur = todayStr(); render(); };

$('waterPlus').onclick = () => { mutDay(cur).water++; save(); };
$('stepSave').onclick = () => {
  const v = Math.round(num($('stepIn').value));
  if ($('stepIn').value === '' || v < 0 || v > 100000) return toast('Enter a step count between 0 and 100,000.');
  mutDay(cur).steps = v; $('stepIn').value = ''; save(); toast('Steps saved.');
};
$('stepIn').onkeydown = e => { if (e.key === 'Enter') $('stepSave').click(); };
$('stepGoalSave').onclick = () => {
  const v = Math.round(num($('stepGoalIn').value));
  if (v < 1000 || v > 50000) return toast('Enter a goal between 1,000 and 50,000 steps.');
  data.stepGoal = v; $('stepGoalIn').value = ''; save(); toast('Step goal set.');
};
$('eatBack').onchange = () => { data.eatBack = $('eatBack').checked; save(); };
$('waterMinus').onclick = () => { const d = mutDay(cur); d.water = Math.max(0, d.water - 1); save(); };

$('mealChips').onclick = e => { const b = e.target.closest('[data-meal]'); if (b) { meal = b.dataset.meal; $('mealChips').innerHTML = chips(meal); renderResults(); } };
$('q').oninput = renderResults;
$('q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (shown.length === 1) openSheet(shown[0]); else searchOnline(); } };
$('results').onclick = e => {
  if (e.target.closest('#onlineBtn')) return searchOnline();
  const del = e.target.closest('[data-smdel]'), sm = e.target.closest('[data-sm]');
  if (del) { const m = data.savedMeals[del.dataset.smdel]; if (confirm(`Delete the saved meal “${m.name}”?`)) { data.savedMeals.splice(+del.dataset.smdel, 1); save(); } return; }
  if (sm) {
    const m = data.savedMeals[sm.dataset.sm];
    mutDay(cur).meals.push(...m.items.map(it => ({ ...it, meal })));
    $('q').value = ''; save(); return toast(`Added “${m.name}” (${fmt(totals(m.items).cal)} kcal)`);
  }
  const b = e.target.closest('[data-i]'); if (b) openSheet(shown[b.dataset.i]);
};
$('meals').onclick = e => {
  const b = e.target.closest('[data-del]'), ed = e.target.closest('[data-edit]'), sv = e.target.closest('[data-savemeal]');
  if (b) { mutDay(cur).meals.splice(+b.dataset.del, 1); save(); }
  else if (sv) openSaveMeal(sv.dataset.savemeal);
  else if (ed) openEdit(+ed.dataset.edit);
};
$('meals').onkeydown = e => { if (e.key === 'Enter' && e.target.dataset.edit != null) openEdit(+e.target.dataset.edit); };

/* ───────── edit a logged item ───────── */
const EDIT_FIELDS = [['edCal', 'cal'], ['edProtein', 'protein'], ['edCarbs', 'carbs'], ['edFat', 'fat'], ['edFiber', 'fiber']];
const FACTORS = [[0.5, '½'], [1, 'Same'], [1.5, '1½×'], [2, '2×']];
let ed = null;
function openEdit(i) {
  const m = getDay(cur).meals[i]; if (!m) return;
  ed = { i, orig: { ...m }, meal: m.meal, factor: 1 };
  $('edName').value = m.name; $('edErr').textContent = '';
  fillEdit(); $('editDlg').showModal();
}
function fillEdit() {
  for (const [id, k] of EDIT_FIELDS) $(id).value = k === 'cal' ? Math.round(num(ed.orig[k]) * ed.factor) : r1(num(ed.orig[k]) * ed.factor);
  $('edFactor').innerHTML = FACTORS.map(([f, label]) => `<button data-f="${f}" class="${f === ed.factor ? 'on' : ''}">${label}</button>`).join('');
  $('edMeals').innerHTML = chips(ed.meal);
}
$('edFactor').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { ed.factor = +b.dataset.f; fillEdit(); } };
$('edMeals').onclick = e => { const b = e.target.closest('[data-meal]'); if (b) { ed.meal = b.dataset.meal; $('edMeals').innerHTML = chips(ed.meal); } };
$('edCancel').onclick = () => $('editDlg').close();
$('edDelete').onclick = () => { mutDay(cur).meals.splice(ed.i, 1); $('editDlg').close(); save(); };
$('edSave').onclick = () => {
  const name = $('edName').value.trim();
  if (!name || $('edCal').value === '') return $('edErr').textContent = 'Enter a name and the calories.';
  const m = mutDay(cur).meals[ed.i];
  m.name = name; m.meal = ed.meal;
  for (const [id, k] of EDIT_FIELDS) m[k] = k === 'cal' ? Math.round(Math.max(0, num($(id).value))) : r1(Math.max(0, num($(id).value)));
  if (ed.factor !== 1) {      // keep the portion text in step: "1 × 1 katori" becomes "2 × 1 katori", "150 g" becomes "300 g"
    const note = ed.orig.note || '1 × serving', qty = note.match(/^([\d.]+)( × .*| g)$/);
    m.note = qty ? r1(num(qty[1]) * ed.factor) + qty[2] : `${ed.factor} × (${note})`;
  }
  $('editDlg').close(); save(); toast('Updated.');
};

/* ───────── saved meals ───────── */
let savingMeal = null;
function openSaveMeal(k) {
  savingMeal = k;
  const items = getDay(cur).meals.filter(m => m.meal === k);
  $('smName').value = 'My usual ' + MEALS.find(x => x[0] === k)[1].toLowerCase().replace(/s$/, '');
  $('smInfo').textContent = `${items.length} item${items.length > 1 ? 's' : ''}, ${fmt(totals(items).cal)} kcal: ${items.map(m => m.name).join(', ')}`;
  $('smErr').textContent = ''; $('saveMealDlg').showModal(); $('smName').select();
}
$('smCancel').onclick = () => $('saveMealDlg').close();
$('smSave').onclick = () => {
  const name = $('smName').value.trim();
  if (!name) return $('smErr').textContent = 'Give the meal a name.';
  const items = getDay(cur).meals.filter(m => m.meal === savingMeal).map(({ meal: _, ...it }) => it);
  data.savedMeals = [{ name, items }].concat(data.savedMeals.filter(m => m.name.toLowerCase() !== name.toLowerCase())).slice(0, 40);
  $('saveMealDlg').close(); save(); toast(`Saved “${name}”. Find it under Add food.`);
};
$('copyYesterday').onclick = () => {
  mutDay(cur).meals = getDay(addDays(cur, -1)).meals.map(m => ({ ...m }));
  save(); toast('Copied yesterday’s meals — remove anything you did not eat.');
};

$('shQty').oninput = renderSheet;
$('shMinus').onclick = () => stepQty(-1);
$('shPlus').onclick = () => stepQty(1);
$('shMeals').onclick = e => { const b = e.target.closest('[data-meal]'); if (b) { sheetMeal = b.dataset.meal; renderSheet(); } };
$('shCancel').onclick = () => $('sheet').close();
$('shAdd').onclick = addFromSheet;

/* ───────── meal ideas ───────── */
// Suggests balanced meals from the built-in list that fit the calories left, the person's diet and what they avoid.
// Fried food, sweets, sugary drinks and alcohol are never suggested.
const DIETS = [['veg', 'Vegetarian'], ['egg', 'Veg + egg'], ['nonveg', 'Non-veg']];
const AVOIDS = [['dairy', 'Dairy'], ['wheat', 'Wheat / gluten'], ['nuts', 'Nuts'], ['seafood', 'Seafood'], ['redmeat', 'Red meat']];
const SHARE = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };
const NAMES = {
  rice: ['White rice, cooked', 'Brown rice, cooked', 'Jeera rice'],
  side: ['Curd / dahi', 'Curd, low-fat', 'Raita', 'Buttermilk / chaas', 'Green salad', 'Kachumber salad'],
  plateExtra: ['Daliya, savoury', 'Thukpa'],
  breakfast: ['Poha', 'Besan chilla', 'Moong dal chilla', 'Oats, cooked', 'Masala oats', 'Daliya, savoury', 'Muesli with milk', 'Cornflakes with milk', 'Thepla', 'Dhokla', 'Handvo',
    'Aloo paratha', 'Gobi paratha', 'Bread omelette', 'Omelette', 'Masala omelette', 'Egg bhurji', 'Boiled egg', 'Sprouts salad', 'Veg sandwich', 'Upma'],
  breakfastSide: ['Chai without sugar', 'Milk, toned', 'Milk, skimmed', 'Curd / dahi', 'Banana', 'Apple', 'Papaya', 'Orange', 'Boiled egg', 'Sambar', 'Black coffee', 'Almonds', 'Guava'],
  snack: ['Roasted chana', 'Makhana, roasted', 'Peanuts, roasted', 'Boiled peanuts', 'Sprouts salad', 'Boiled chana', 'Buttermilk / chaas', 'Coconut water', 'Black / green tea', 'Boiled egg',
    'Corn chaat', 'Roasted corn', 'Sweet potato, boiled', 'Dhokla', 'Khakhra', 'Greek yogurt, plain low-fat', 'Curd / dahi', 'Chai without sugar', 'Vegetable soup', 'Tomato soup',
    'Chicken soup', 'Kachumber salad', 'Green salad', 'Almonds', 'Walnuts'],
  light: ['Cucumber', 'Carrot', 'Tomato', 'Green salad', 'Kachumber salad', 'Black / green tea', 'Black coffee', 'Buttermilk / chaas', 'Rasam', 'Jaljeera']
};
let ideaMeal = null, ideaList = [], ideaKey = '', ideaShuffle = 0;

function ideaPools() {
  const pr = data.prefs, rank = { veg: 0, egg: 1, nonveg: 2 };
  const dislikes = pr.dislikes.toLowerCase().split(/[,\n]+/).map(w => w.trim()).filter(w => w.length > 1);
  const ok = FOODS.filter(f => rank[f.diet] <= rank[pr.diet] && !f.has.some(t => pr.avoid.includes(t) || t === 'fried' || t === 'alcohol') && !dislikes.some(w => f.keys.includes(w)));
  const named = list => ok.filter(f => list.includes(f.name));
  return {
    roti: ok.filter(f => f.cat === 'bread' && f.fat <= 4.5 && f.cal <= 190 && !/bread|rusk|pav|puran/i.test(f.name)),
    rice: named(NAMES.rice),
    protein: ok.filter(f => (f.cat === 'dal' && !/^Soya chunks$|Rasam|Tofu|Sprouts|Boiled/.test(f.name)) || (f.cat === 'paneer' && /paneer/i.test(f.name) && f.name !== 'Paneer' && f.fat <= 21) ||
      (f.cat === 'nonveg' && f.fat <= 18 && !/Egg white|Bread omelette|soup|Boiled egg/.test(f.name))),
    veg: ok.filter(f => f.cat === 'veg' && f.fat <= 12 && !/soup/i.test(f.name)),
    side: named(NAMES.side),
    plate: ok.filter(f => (f.cat === 'rice' && !NAMES.rice.includes(f.name) && f.name !== 'Poha' && f.fat <= 14) || NAMES.plateExtra.includes(f.name)),
    breakfast: ok.filter(f => (f.cat === 'tiffin' && !/chutney/i.test(f.name)) || NAMES.breakfast.includes(f.name)),
    breakfastSide: named(NAMES.breakfastSide),
    snack: ok.filter(f => (f.cat === 'fruit' && !/Onion|Tomato|Raisins|Fresh coconut/.test(f.name)) || NAMES.snack.includes(f.name)),
    light: named(NAMES.light)
  };
}
function makeIdeas(kind, budget, P) {
  const pick = a => a[Math.floor(Math.random() * a.length)], clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sum = items => items.reduce((a, [f, n]) => a + f.cal * n, 0);
  const fill = (items, pool, max) => {            // add sides while they fit in the calories left
    for (let k = 0; k < max; k++) {
      const gap = budget - sum(items), fits = pool.filter(f => f.cal <= gap && f.cal >= 20 && !items.some(x => x[0] === f));
      if (gap < 45 || !fits.length) break;
      items.push([pick(fits), 1]);
    }
  };
  const found = new Map();
  for (let t = 0; t < 500; t++) {
    let items = [];
    if (kind === 'main') {
      if (Math.random() < 0.25 && P.plate.length) { items = [[pick(P.plate), 1]]; fill(items, P.side, 2); }
      else {
        if (!P.protein.length || !P.veg.length) continue;
        const prot = pick(P.protein), veg = pick(P.veg), rest = prot.cal + veg.cal;
        const useRoti = P.roti.length && (!P.rice.length || Math.random() < 0.7);
        const st = useRoti ? pick(P.roti) : P.rice.length ? pick(P.rice) : null;
        if (st) items.push([st, useRoti ? clamp(Math.round((budget - rest) / st.cal), 1, 4) : (budget - rest) / st.cal >= 1.4 ? 1.5 : 1]);
        items.push([prot, 1], [veg, 1]); fill(items, P.side, 1);
      }
    } else if (kind === 'breakfast') {
      if (!P.breakfast.length) continue;
      const m = pick(P.breakfast); items = [[m, clamp(Math.round(budget * 0.7 / m.cal), 1, 2)]]; fill(items, P.breakfastSide, 3);
    } else {
      const pool = kind === 'light' ? P.light : P.snack;
      if (!pool.length) continue;
      const a = pick(pool); if (a.cal > budget * 1.1) continue;
      items = [[a, 1]]; if (kind === 'snack') fill(items, pool, 1);
    }
    const cal = sum(items);
    if (cal > budget * 1.08 || cal < budget * (kind === 'main' || kind === 'breakfast' ? 0.75 : 0.35)) continue;
    const tot = items.reduce((a, [f, n]) => ({ protein: a.protein + f.protein * n, carbs: a.carbs + f.carbs * n, fat: a.fat + f.fat * n, fiber: a.fiber + f.fiber * n }), { protein: 0, carbs: 0, fat: 0, fiber: 0 });
    // prefer ideas close to the budget and rich in protein and fiber, with some randomness for variety
    const score = 2 * (1 - Math.abs(budget - cal) / budget) + tot.protein / cal * 12 + tot.fiber / cal * 12 + Math.random() * 0.8;
    const key = items.map(x => x[0].name).sort().join('|');
    if (!found.has(key) || found.get(key).score < score) found.set(key, { items, cal, ...tot, score });
  }
  const out = [], used = new Set();
  for (const idea of [...found.values()].sort((a, b) => b.score - a.score)) {
    // one idea per main dish; for snacks, no food appears twice
    const names = kind === 'main' || kind === 'breakfast' ? [idea.items[kind === 'main' && idea.items.length > 2 ? 1 : 0][0].name] : idea.items.map(x => x[0].name);
    if (names.some(n => used.has(n))) continue;
    names.forEach(n => used.add(n)); out.push(idea);
    if (out.length === 4) break;
  }
  return out;
}
function renderIdeas() {
  if (!ideaMeal) ideaMeal = meal;
  const p = plan(), d = getDay(cur), left = p.cal + stepBonus(cur) - totals(d.meals).cal, label = MEALS.find(x => x[0] === ideaMeal)[1];
  const inMeal = totals(d.meals.filter(m => m.meal === ideaMeal)).cal;
  let budget = Math.min(left, SHARE[ideaMeal] * p.cal - inMeal), kind = ideaMeal === 'snack' ? 'snack' : ideaMeal === 'breakfast' ? 'breakfast' : 'main', info;
  if (left < 60) { budget = 60; kind = 'light'; info = 'You have reached today’s target. If you are still hungry, these are almost free:'; }
  else if (budget < 180 && kind !== 'snack') { budget = Math.min(left, 150); kind = 'snack'; info = `${label} is mostly used up — light options of about ${fmt(budget)} kcal (${fmt(left)} kcal left today):`; }
  else { budget = Math.max(budget, Math.min(left, 100)); info = `Ideas for ${label.toLowerCase()} of about ${fmt(Math.round(budget / 10) * 10)} kcal (${fmt(left)} kcal left today):`; }
  budget = Math.round(budget / 10) * 10;
  const pr = data.prefs, key = [cur, ideaMeal, kind, budget, JSON.stringify(pr), ideaShuffle].join('#');
  if (key !== ideaKey) { ideaKey = key; ideaList = makeIdeas(kind, budget, ideaPools()); }
  $('ideaChips').innerHTML = chips(ideaMeal);
  $('ideaPrefs').textContent = DIETS.find(x => x[0] === pr.diet)[1] + (pr.avoid.length ? ' · no ' + pr.avoid.map(a => AVOIDS.find(x => x[0] === a)[1].toLowerCase()).join(', ') : '') + (pr.dislikes.trim() ? ' · skipping ' + pr.dislikes.trim() : '');
  $('ideaInfo').textContent = info;
  const qty = ([f, n]) => `${n === 1 ? '' : n + ' × '}${esc(f.name)} <span class="muted">(${esc(f.serving)})</span>`;
  $('ideas').innerHTML = ideaList.length ? ideaList.map((it, i) =>
    `<div class="item idea"><div class="txt">${it.items.map(qty).join('<br>')}<br><small>${fmt(it.cal)} kcal · P ${fmt(it.protein)} · C ${fmt(it.carbs)} · F ${fmt(it.fat)} · Fiber ${fmt(it.fiber)} g</small></div><button class="green small" data-idea="${i}">Add</button></div>`).join('')
    : '<p class="muted">Nothing fits these preferences and calories. Try loosening the preferences.</p>';
  $('ideaMore').hidden = !ideaList.length;
}
$('ideaChips').onclick = e => { const b = e.target.closest('[data-meal]'); if (b) { ideaMeal = b.dataset.meal; renderIdeas(); } };
$('ideaMore').onclick = () => { ideaShuffle++; renderIdeas(); };
$('ideas').onclick = e => {
  const b = e.target.closest('[data-idea]'); if (!b) return;
  const it = ideaList[b.dataset.idea];
  for (const [f, n] of it.items) mutDay(cur).meals.push({ name: f.name, meal: ideaMeal, note: `${n} × ${f.serving}`, cal: Math.round(f.cal * n), protein: r1(f.protein * n), carbs: r1(f.carbs * n), fat: r1(f.fat * n), fiber: r1(f.fiber * n) });
  save(); toast(`Added ${it.items.length} item${it.items.length > 1 ? 's' : ''} to ${MEALS.find(x => x[0] === ideaMeal)[1]}`);
};
let prefDraft = null;
function renderPrefs() {
  $('pfDiet').innerHTML = DIETS.map(([k, l]) => `<button data-diet="${k}" class="${k === prefDraft.diet ? 'on' : ''}">${l}</button>`).join('');
  $('pfAvoid').innerHTML = AVOIDS.map(([k, l]) => `<button data-avoid="${k}" class="${prefDraft.avoid.includes(k) ? 'on' : ''}" aria-pressed="${prefDraft.avoid.includes(k)}">${l}</button>`).join('');
}
$('prefBtn').onclick = () => { prefDraft = { diet: data.prefs.diet, avoid: [...data.prefs.avoid] }; $('pfDislikes').value = data.prefs.dislikes; renderPrefs(); $('prefDlg').showModal(); };
$('pfDiet').onclick = e => { const b = e.target.closest('[data-diet]'); if (b) { prefDraft.diet = b.dataset.diet; renderPrefs(); } };
$('pfAvoid').onclick = e => {
  const b = e.target.closest('[data-avoid]'); if (!b) return;
  const k = b.dataset.avoid; prefDraft.avoid = prefDraft.avoid.includes(k) ? prefDraft.avoid.filter(x => x !== k) : prefDraft.avoid.concat(k); renderPrefs();
};
$('pfCancel').onclick = () => $('prefDlg').close();
$('pfSave').onclick = () => { data.prefs = { ...prefDraft, dislikes: $('pfDislikes').value.trim().slice(0, 200) }; $('prefDlg').close(); save(); };

$('customBtn').onclick = () => { $('cErr').textContent = ''; $('cName').value = $('q').value.trim(); $('customDlg').showModal(); };
$('cCancel').onclick = () => $('customDlg').close();
$('cSave').onclick = () => {
  const name = $('cName').value.trim();
  if (!name || $('cCal').value === '') return $('cErr').textContent = 'Enter a name and the calories.';
  const f = { name, serving: $('cServing').value.trim() || '1 serving', cal: Math.max(0, num($('cCal').value)), protein: Math.max(0, num($('cProtein').value)),
    carbs: Math.max(0, num($('cCarbs').value)), fat: Math.max(0, num($('cFat').value)), fiber: Math.max(0, num($('cFiber').value)) };
  $('customDlg').close();
  for (const id of ['cName', 'cServing', 'cCal', 'cProtein', 'cCarbs', 'cFat', 'cFiber']) $(id).value = '';
  openSheet(f);
};

if ('BarcodeDetector' in window && navigator.mediaDevices) { $('scanBtn').hidden = false; $('scanBtn').onclick = openScanner; }
$('scanClose').onclick = () => $('scanDlg').close();
$('scanDlg').addEventListener('close', stopScanner);
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

$('saveWeight').onclick = () => {
  const kg = num($('weightIn').value);
  if (kg < 20 || kg > 400) return toast('Enter a weight in kg.');
  setWeight(cur, kg); $('weightIn').value = ''; save(); toast('Weight saved.');
};
$('weightList').onclick = e => { const b = e.target.closest('[data-delw]'); if (b) { data.weights = data.weights.filter(x => x.date !== b.dataset.delw); save(); } };

$('savePlan').onclick = savePlan;
$('manualSet').onclick = () => {
  const v = Math.round(num($('manualIn').value));
  if (v < 800 || v > 6000) return toast('Enter a daily target between 800 and 6000 kcal.');
  data.manualTarget = v; $('manualIn').value = ''; save(); toast('Custom target set.');
};
$('manualClear').onclick = () => { data.manualTarget = null; save(); };
$('adaptiveOn').onchange = () => { data.adaptive = $('adaptiveOn').checked; save(); };

$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `foodtrack-backup-${todayStr()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0]; $('importFile').value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || typeof j !== 'object' || !j.days) throw 0;
    if (!confirm('Replace everything on this device with the backup?')) return;
    data = normalise(j); planFormFilled = false; save(); toast('Backup restored.');
  } catch (e) { toast('That file is not a FoodTrack backup.'); }
};
$('resetBtn').onclick = () => {
  if (!confirm('Erase all meals, weights and your plan from this device? This cannot be undone.')) return;
  data = normalise(null); planFormFilled = false; cur = todayStr(); save(); toast('All data erased.');
};

/* ───────── AI photo recognition ───────── */
let ph = { image: null, items: [], meal: null, busy: false };
// Shrink the photo in the browser first: faster upload, cheaper to analyse, and well under the server's size limit.
async function shrinkPhoto(file, max = 1280) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    src = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = URL.createObjectURL(file); });
  }
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
function renderPhoto() {
  const has = !!ph.image, got = ph.items.length > 0;
  $('phPreview').hidden = !has;
  if (has) $('phPreview').src = ph.image;
  $('phCamera').textContent = has ? '📷 Retake' : '📷 Camera';
  $('phGallery').textContent = has ? '🖼️ Another' : '🖼️ Gallery';
  $('phCamera').disabled = $('phGallery').disabled = ph.busy;
  $('phHint').hidden = !has || got;
  $('phAnalyze').hidden = !has || got;
  $('phAnalyze').disabled = ph.busy;
  $('phAnalyze').textContent = ph.busy ? 'Analysing…' : 'Analyze';
  $('phMeals').hidden = $('phAdd').hidden = !got;
  $('phMeals').innerHTML = chips(ph.meal);
  $('phItems').innerHTML = ph.items.map((it, i) =>
    `<label class="item"><input type="checkbox" data-pi="${i}" ${it.on ? 'checked' : ''}><span class="txt"><b>${esc(it.name)}</b>${it.confidence === 'low' ? '<span class="pill">unsure</span>' : ''}<br>
     <small>${esc(it.portion)} · P ${r1(it.protein)} · C ${r1(it.carbs)} · F ${r1(it.fat)} g</small></span>
     <input class="cal" type="number" inputmode="numeric" min="0" data-pc="${i}" value="${Math.round(it.cal)}" aria-label="Calories for ${esc(it.name)}"><small>kcal</small></label>`).join('');
  updatePhotoTotal();
}
function updatePhotoTotal() {
  const sel = ph.items.filter(it => it.on);
  $('phAdd').disabled = !sel.length;
  $('phAdd').textContent = sel.length ? `Add ${fmt(sel.reduce((a, it) => a + it.cal, 0))} kcal` : 'Add selected';
}
function openPhoto() {
  ph = { image: null, items: [], meal, busy: false };
  $('phStatus').textContent = ''; $('phHint').value = '';
  renderPhoto(); $('photoDlg').showModal();
}
async function photoPicked(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  try { ph.image = await shrinkPhoto(f); ph.items = []; $('phStatus').textContent = ''; }
  catch (e) { $('phStatus').textContent = 'Could not read that photo. Try another one.'; }
  renderPhoto();
}
async function analysePhoto() {
  if (!ph.image || ph.busy) return;
  ph.busy = true; $('phStatus').textContent = 'Looking at your meal… this usually takes 5–20 seconds.'; renderPhoto();
  let msg = '';
  try {
    const r = await fetch('api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: ph.image.split(',')[1], mediaType: 'image/jpeg', hint: $('phHint').value }) });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON: the function is not deployed on this host */ }
    if (!j) msg = 'Photo recognition is not available on this copy of the site. It needs the Vercel deployment with an API key.';
    else if (!r.ok) msg = j.error || 'The photo could not be analysed. Try again.';
    else if (!j.isFood || !j.items.length) msg = 'No food found in that photo. Try a clearer picture, or add a description.';
    else {
      ph.items = j.items.map(it => ({ ...it, on: true }));
      msg = 'Estimates can easily be 20–30% off. Untick anything wrong and correct the calories if you know better.' + (j.note ? ' Note: ' + j.note : '');
    }
  } catch (e) { msg = 'Could not reach the server. Check your connection and try again.'; }
  ph.busy = false; $('phStatus').textContent = msg; renderPhoto();
}
function addPhotoItems() {
  const sel = ph.items.filter(it => it.on);
  if (!sel.length) return;
  for (const it of sel) {
    mutDay(cur).meals.push({ name: it.name, meal: ph.meal, note: `${it.portion} · AI estimate`, cal: Math.round(it.cal), protein: r1(it.protein), carbs: r1(it.carbs), fat: r1(it.fat), fiber: r1(it.fiber) });
    const rec = { name: it.name, serving: it.portion, cal: it.cal, protein: it.protein, carbs: it.carbs, fat: it.fat, fiber: it.fiber };
    data.recents = [rec].concat(data.recents.filter(x => !(x.name === rec.name && x.serving === rec.serving))).slice(0, 30);
  }
  meal = ph.meal; $('photoDlg').close(); save();
  toast(`Added ${sel.length} item${sel.length > 1 ? 's' : ''} from your photo`);
}
$('photoBtn').onclick = openPhoto;
$('phCamera').onclick = () => $('phCamIn').click();
$('phGallery').onclick = () => $('phGalIn').click();
$('phCamIn').onchange = () => photoPicked($('phCamIn'));
$('phGalIn').onchange = () => photoPicked($('phGalIn'));
$('phAnalyze').onclick = analysePhoto;
$('phAdd').onclick = addPhotoItems;
$('phClose').onclick = () => $('photoDlg').close();
$('phMeals').onclick = e => { const b = e.target.closest('[data-meal]'); if (b) { ph.meal = b.dataset.meal; $('phMeals').innerHTML = chips(ph.meal); } };
$('phItems').onchange = e => {
  const t = e.target;
  if (t.dataset.pi != null) ph.items[t.dataset.pi].on = t.checked;
  if (t.dataset.pc != null) {           // correcting the calories scales the macros with it
    const it = ph.items[t.dataset.pc], cal = Math.max(0, num(t.value)), k = it.cal > 0 ? cal / it.cal : 1;
    Object.assign(it, { cal, protein: it.protein * k, carbs: it.carbs * k, fat: it.fat * k, fiber: it.fiber * k });
  }
  updatePhotoTotal();
};

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderProgress, 150); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
