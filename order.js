import { rpc, money, param, toLines, toCounts, friendlyError } from './api.js';

const TOKEN = param('t');
const STEPS = 5; // welcome, pot, personal, drinks, review
const POT_SECTIONS = ['Small Plates', 'Sides'];
const OWN_SECTIONS = ['Large Plates', 'Desserts'];

const el = (id) => document.getElementById(id);

const state = {
  menu: [],
  rules: null,
  step: 0,
  food: {},      // personal — large plates + desserts
  pot: {},       // shared table plates
  cocktails: {},
  potUsedByOthers: 0,
  submitted: false,
};

let saveTimer = null;
let toastTimer = null;

/* ---------------- totals ---------------- */

const priceOf = (id) => state.menu.find((m) => m.id === id)?.price ?? 0;
const sum = (counts) => Object.entries(counts).reduce((t, [id, q]) => t + priceOf(id) * q, 0);

const foodTotal = () => sum(state.food);
const potMine = () => sum(state.pot);
const potRemaining = () =>
  Math.max(0, Number(state.rules.pot_cap) - state.potUsedByOthers - potMine());
const cocktailCount = () => Object.values(state.cocktails).reduce((a, b) => a + b, 0);

/* ---------------- chrome ---------------- */

function toast(msg, kind = '') {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = msg;
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

function renderProgress() {
  const bar = el('progress');
  bar.textContent = '';
  for (let i = 0; i < STEPS; i++) {
    const dot = document.createElement('i');
    if (i < state.step) dot.className = 'done';
    if (i === state.step) dot.className = 'now';
    bar.appendChild(dot);
  }
}

// The sticky meter only means something on the personal-budget step.
function renderBudgetBar() {
  const show = state.step === 2;
  el('budgetBar').hidden = !show;
  if (!show) return;

  const cap = Number(state.rules.food_cap);
  const total = foodTotal();
  const ratio = cap > 0 ? Math.min(1, total / cap) : 0;

  el('budgetLeft').textContent = `${money(Math.max(0, cap - total))} left`;
  el('budgetCap').textContent = `${money(total)} of ${money(cap)}`;
  el('meterFill').style.transform = `scaleX(${ratio})`;

  const meter = el('meter');
  meter.classList.toggle('warn', ratio >= 0.78 && ratio < 1);
  meter.classList.toggle('full', ratio >= 1);
}

function renderPotBar() {
  const cap = Number(state.rules.pot_cap);
  const used = state.potUsedByOthers + potMine();
  const ratio = cap > 0 ? Math.min(1, used / cap) : 0;

  el('potLeft').textContent = `${money(potRemaining())} left`;
  el('potUsed').textContent = `${money(potMine())} added by you`;
  el('potFill').style.transform = `scaleX(${ratio})`;

  const meter = el('potMeter');
  meter.classList.toggle('warn', ratio >= 0.78 && ratio < 1);
  meter.classList.toggle('full', ratio >= 1);
}

/* ---------------- items ---------------- */

function bucketFor(item) {
  if (item.kind === 'cocktail') return state.cocktails;
  return item.pot_eligible ? state.pot : state.food;
}

function isBlocked(item) {
  if (item.kind === 'cocktail') return cocktailCount() >= Number(state.rules.cocktail_cap);
  if (item.pot_eligible) return item.price > potRemaining();
  return item.price > Number(state.rules.food_cap) - foodTotal();
}

function itemRow(m) {
  const qty = bucketFor(m)[m.id] || 0;
  const blocked = isBlocked(m);

  const row = document.createElement('div');
  row.className = `item${qty > 0 ? ' picked' : ''}${blocked && qty === 0 ? ' blocked' : ''}`;

  const main = document.createElement('div');
  main.className = 'item-main';

  const name = document.createElement('div');
  name.className = 'item-name';
  name.textContent = m.name;
  main.appendChild(name);

  if (m.description) {
    const d = document.createElement('div');
    d.className = 'item-desc';
    d.textContent = m.description;
    main.appendChild(d);
  }
  if (m.note) {
    const n = document.createElement('span');
    n.className = 'item-note';
    n.textContent = m.note;
    main.appendChild(n);
  }

  const right = document.createElement('div');
  right.className = 'item-right';

  const price = document.createElement('div');
  price.className = 'item-price';
  price.textContent = money(m.price);
  right.appendChild(price);

  const stepper = document.createElement('div');
  stepper.className = 'stepper';

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.textContent = '−';
  minus.disabled = qty === 0;
  minus.setAttribute('aria-label', `Remove one ${m.name}`);
  minus.onclick = () => change(m, -1);

  const count = document.createElement('span');
  count.className = 'qty';
  count.textContent = String(qty);

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.textContent = '+';
  plus.disabled = blocked;
  plus.setAttribute('aria-label', `Add one ${m.name}`);
  plus.onclick = () => change(m, 1);

  stepper.append(minus, count, plus);
  right.appendChild(stepper);
  row.append(main, right);
  return row;
}

function fillList(node, sections, kind) {
  node.textContent = '';
  const groups = kind === 'cocktail' ? [null] : sections;

  for (const section of groups) {
    const items = state.menu.filter((m) =>
      kind === 'cocktail' ? m.kind === 'cocktail' : m.kind === 'food' && m.section === section);
    if (!items.length) continue;

    if (section) {
      const h = document.createElement('h3');
      h.className = 'section-title';
      h.textContent = section;
      node.appendChild(h);
    }
    items.forEach((m) => node.appendChild(itemRow(m)));
  }
}

/* ---------------- review ---------------- */

function fillReview(node, counts, showMoney = true) {
  node.textContent = '';
  const entries = Object.entries(counts).filter(([, q]) => q > 0);

  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'review-empty';
    li.textContent = 'Nothing picked.';
    node.appendChild(li);
    return;
  }

  for (const [id, qty] of entries) {
    const m = state.menu.find((x) => x.id === id);
    if (!m) continue;

    const li = document.createElement('li');
    const left = document.createElement('span');
    const badge = document.createElement('span');
    badge.className = 'qty-badge';
    badge.textContent = `${qty}×`;
    left.append(badge, document.createTextNode(m.name));
    li.appendChild(left);

    if (showMoney) {
      const right = document.createElement('span');
      right.textContent = money(m.price * qty);
      li.appendChild(right);
    }
    node.appendChild(li);
  }
}

function renderReview() {
  fillReview(el('revPot'), state.pot);
  fillReview(el('revFood'), state.food);
  fillReview(el('revCk'), state.cocktails, false);
  el('revTotal').textContent = money(foodTotal());

  const box = el('doneBanner');
  box.textContent = '';
  if (state.submitted) {
    const b = document.createElement('div');
    b.className = 'banner';
    b.textContent = "Sent. Dex has your order.";
    box.appendChild(b);
  }
}

/* ---------------- step machine ---------------- */

function showStep(n) {
  state.step = Math.max(0, Math.min(STEPS - 1, n));

  document.querySelectorAll('.step').forEach((s) => {
    s.classList.toggle('active', Number(s.dataset.step) === state.step);
  });

  el('backBtn').hidden = state.step === 0;

  const next = el('nextBtn');
  if (state.step === 0) next.textContent = "Let's go";
  else if (state.step === STEPS - 1) next.textContent = state.submitted ? 'Update my order' : 'Send to Dex';
  else next.textContent = 'Next';
  next.disabled = state.rules.locked && state.step === STEPS - 1;

  renderProgress();
  renderBudgetBar();
  if (state.step === 4) renderReview();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderLists() {
  fillList(el('potList'), POT_SECTIONS, 'food');
  fillList(el('foodList'), OWN_SECTIONS, 'food');
  fillList(el('cocktailList'), null, 'cocktail');
  renderPotBar();
  renderBudgetBar();
}

/* ---------------- actions ---------------- */

function change(item, delta) {
  const bucket = bucketFor(item);
  const next = (bucket[item.id] || 0) + delta;

  if (next <= 0) delete bucket[item.id];
  else bucket[item.id] = Math.min(next, 10);

  // Fast local feedback. The server is still the authority on all three caps.
  if (delta > 0) {
    const breach =
      (bucket === state.food && foodTotal() > Number(state.rules.food_cap)) ||
      (bucket === state.pot && state.potUsedByOthers + potMine() > Number(state.rules.pot_cap));

    if (breach) {
      bucket[item.id] -= 1;
      if (!bucket[item.id]) delete bucket[item.id];
      toast(bucket === state.pot ? 'The table pot is full.' : `That goes over your ${money(state.rules.food_cap)}.`, 'err');
      return;
    }
  }

  renderLists();
  queueSave();
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(false), 700);
}

function applyServer(res) {
  state.submitted = Boolean(res.order.submitted_at);
  // Someone else may have taken from the pot since we last looked.
  state.potUsedByOthers = Number(res.pot.used) - Number(res.order.pot_total);
}

async function save(submit) {
  try {
    const res = await rpc('bday_save_order', {
      p_token: TOKEN,
      p_food: toLines(state.food),
      p_pot: toLines(state.pot),
      p_cocktails: toLines(state.cocktails),
      p_submit: submit,
    });
    applyServer(res);
    renderPotBar();
    if (submit) toast('Order sent 🎉', 'ok');
    return true;
  } catch (err) {
    const msg = String(err?.message ?? '');
    if (msg.includes('pot_full')) {
      // Another guest got there first — resync and drop our last add.
      await refreshPot();
      toast('Someone just took the last of the pot. Adjusted.', 'err');
    } else {
      toast(friendlyError(err), 'err');
    }
    return false;
  }
}

async function refreshPot() {
  try {
    const mine = await rpc('bday_get_guest', { p_token: TOKEN });
    state.pot = toCounts(mine.order.pot_lines);
    applyServer(mine);
    renderLists();
  } catch { /* leave the last known state on screen */ }
}

/* ---------------- boot ---------------- */

async function boot() {
  if (!TOKEN) {
    el('state').textContent = 'You need your own invite link. Ask Dex to send it.';
    return;
  }

  try {
    const [meta, mine] = await Promise.all([
      rpc('bday_menu_and_rules'),
      rpc('bday_get_guest', { p_token: TOKEN }),
    ]);

    state.menu = meta.menu;
    state.rules = meta.rules;
    state.food = toCounts(mine.order.food_lines);
    state.pot = toCounts(mine.order.pot_lines);
    state.cocktails = toCounts(mine.order.cocktail_lines);
    applyServer(mine);

    el('guestName').textContent = mine.guest.name;
    el('welcomeVenue').textContent = state.rules.venue;
    el('welcomeDate').textContent = new Date(state.rules.event_date + 'T00:00:00').toLocaleDateString(
      'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    el('wPot').textContent = money(state.rules.pot_cap);
    el('wFood').textContent = money(state.rules.food_cap);
    el('wCk').textContent = state.rules.cocktail_cap;
    el('ckCap').textContent = state.rules.cocktail_cap;
    document.title = `${mine.guest.name} — pick your food`;

    if (state.rules.locked) {
      const b = document.createElement('div');
      b.className = 'banner warn';
      b.textContent = 'Orders are locked in. Talk to Dex if you need a change.';
      el('statusBanner').appendChild(b);
    }

    el('state').hidden = true;
    el('app').hidden = false;
    el('progress').hidden = false;
    el('navbar').hidden = false;

    renderLists();
    showStep(0);
  } catch (err) {
    el('state').textContent = friendlyError(err);
  }
}

el('backBtn').onclick = () => showStep(state.step - 1);

el('nextBtn').onclick = async () => {
  if (state.step < STEPS - 1) {
    if (state.step === 0) await refreshPot(); // fresh pot figure on the way in
    showStep(state.step + 1);
    return;
  }

  const btn = el('nextBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  clearTimeout(saveTimer);
  const ok = await save(true);
  btn.disabled = false;
  btn.textContent = ok ? 'Update my order' : 'Send to Dex';
  renderReview();
};

boot();
