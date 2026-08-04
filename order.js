import { rpc, money, param, toLines, toCounts, friendlyError } from './api.js';

const TOKEN = param('t');

/* Each picking step declares which menu sections it owns and which budget
   bucket those items are charged to. Adding a step is a one-line change. */
const STEPS = [
  { id: 'welcome', label: 'Start' },
  { id: 'table', label: 'Table', bucket: 'pot', sections: ['Small Plates', 'Sides'], list: 'listPot', optional: true },
  { id: 'main', label: 'Main', bucket: 'food', sections: ['Large Plates'], list: 'listMain', optional: true },
  { id: 'dessert', label: 'Sweet', bucket: 'food', sections: ['Desserts'], list: 'listDessert', optional: true },
  { id: 'drinks', label: 'Drinks', bucket: 'cocktails', kind: 'cocktail', list: 'listDrinks', optional: true },
  { id: 'review', label: 'Review' },
];

const LAST = STEPS.length - 1;
const el = (id) => document.getElementById(id);

const state = {
  menu: [],
  rules: null,
  step: 0,
  furthest: 0,
  food: {},
  pot: {},
  cocktails: {},
  potUsedByOthers: 0,
  submitted: false,
};

let saveTimer = null;
let toastTimer = null;

/* ---------------- totals ---------------- */

const priceOf = (id) => state.menu.find((m) => m.id === id)?.price ?? 0;
const sumOf = (counts) => Object.entries(counts).reduce((t, [id, q]) => t + priceOf(id) * q, 0);

const foodTotal = () => sumOf(state.food);
const potMine = () => sumOf(state.pot);
const potRemaining = () =>
  Math.max(0, Number(state.rules.pot_cap) - state.potUsedByOthers - potMine());
const foodRemaining = () => Math.max(0, Number(state.rules.food_cap) - foodTotal());
const cocktailCount = () => Object.values(state.cocktails).reduce((a, b) => a + b, 0);

const bucketOf = (name) => (name === 'pot' ? state.pot : name === 'food' ? state.food : state.cocktails);

/* Items belonging to one step, in menu order. */
function itemsFor(step) {
  if (step.kind === 'cocktail') return state.menu.filter((m) => m.kind === 'cocktail');
  if (!step.sections) return [];
  return state.menu.filter((m) => m.kind === 'food' && step.sections.includes(m.section));
}

const pickedIn = (step) =>
  itemsFor(step).reduce((n, m) => n + (bucketOf(step.bucket)[m.id] || 0), 0);

/* ---------------- feedback ---------------- */

function toast(msg, kind = '') {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.setAttribute('role', 'status');
  node.textContent = msg;
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

/* ---------------- rail ---------------- */

function renderRail() {
  const wrap = el('railInner');
  wrap.textContent = '';

  STEPS.forEach((step, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = step.label;

    if (i === state.step) btn.setAttribute('aria-current', 'step');
    if (i < state.furthest) btn.classList.add('visited');

    // Don't let people skip ahead past where they've been.
    btn.disabled = i > state.furthest;
    btn.onclick = () => goto(i);
    wrap.appendChild(btn);
  });
}

/* ---------------- gauges ---------------- */

function paintMeter(meterId, fillId, ratio) {
  el(fillId).style.transform = `scaleX(${ratio})`;
  const meter = el(meterId);
  meter.classList.toggle('warn', ratio >= 0.8 && ratio < 1);
  meter.classList.toggle('full', ratio >= 1);
}

function renderGauges() {
  const potCap = Number(state.rules.pot_cap);
  const potUsed = state.potUsedByOthers + potMine();
  el('potLeft').textContent = `${money(potRemaining())} left in the pot`;
  el('potMine').textContent = `you've added ${money(potMine())}`;
  paintMeter('potMeter', 'potFill', potCap > 0 ? Math.min(1, potUsed / potCap) : 0);

  const foodCap = Number(state.rules.food_cap);
  const ratio = foodCap > 0 ? Math.min(1, foodTotal() / foodCap) : 0;

  for (const [leftId, usedId, meterId, fillId] of [
    ['foodLeft', 'foodUsed', 'foodMeter', 'foodFill'],
    ['foodLeft2', 'foodUsed2', 'foodMeter2', 'foodFill2'],
  ]) {
    el(leftId).textContent = `${money(foodRemaining())} left`;
    el(usedId).textContent = `${money(foodTotal())} of ${money(foodCap)}`;
    paintMeter(meterId, fillId, ratio);
  }
}

/* ---------------- items ---------------- */

function isBlocked(item, step) {
  if (step.kind === 'cocktail') return cocktailCount() >= Number(state.rules.cocktail_cap);
  return item.pot_eligible ? item.price > potRemaining() : item.price > foodRemaining();
}

function itemRow(m, step) {
  const counts = bucketOf(step.bucket);
  const qty = counts[m.id] || 0;
  const blocked = isBlocked(m, step);

  const row = document.createElement('div');
  row.className = `item${qty > 0 ? ' picked' : ''}${blocked && qty === 0 ? ' blocked' : ''}`;

  const main = document.createElement('div');

  const name = document.createElement('div');
  name.className = 'item-name';
  name.append(document.createTextNode(m.name));
  if (m.note) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = m.note;
    name.appendChild(tag);
  }
  main.appendChild(name);

  if (m.description) {
    const desc = document.createElement('p');
    desc.className = 'item-desc';
    desc.textContent = m.description;
    main.appendChild(desc);
  }

  const controls = document.createElement('div');
  controls.className = 'item-controls';

  const price = document.createElement('span');
  price.className = 'item-price';
  price.textContent = money(m.price);
  controls.appendChild(price);

  const stepper = document.createElement('div');
  stepper.className = 'stepper';

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.textContent = '−';
  minus.disabled = qty === 0;
  minus.setAttribute('aria-label', `Remove one ${m.name}`);
  minus.onclick = () => change(m, step, -1);

  const count = document.createElement('span');
  count.className = 'qty';
  count.textContent = String(qty);
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-label', `${qty} ${m.name}`);

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.textContent = '+';
  plus.disabled = blocked;
  plus.setAttribute('aria-label', `Add one ${m.name}`);
  plus.onclick = () => change(m, step, 1);

  stepper.append(minus, count, plus);
  controls.appendChild(stepper);
  row.append(main, controls);
  return row;
}

function renderList(step) {
  const node = el(step.list);
  node.textContent = '';

  const items = itemsFor(step);
  const grouped = step.sections && step.sections.length > 1;

  for (const section of grouped ? step.sections : [null]) {
    const slice = section ? items.filter((m) => m.section === section) : items;
    if (!slice.length) continue;

    if (section) {
      const label = document.createElement('h2');
      label.className = 'group-label';
      label.textContent = section;
      node.appendChild(label);
    }
    slice.forEach((m) => node.appendChild(itemRow(m, step)));
  }
}

const renderAllLists = () => STEPS.filter((s) => s.list).forEach(renderList);

/* ---------------- review ---------------- */

function fillRecap(nodeId, step, withPrices = true) {
  const node = el(nodeId);
  node.textContent = '';

  const counts = bucketOf(step.bucket);
  const rows = itemsFor(step)
    .map((m) => [m, counts[m.id] || 0])
    .filter(([, q]) => q > 0);

  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'recap-empty';
    p.textContent = 'Nothing picked yet.';
    node.appendChild(p);
    return;
  }

  for (const [m, qty] of rows) {
    const li = document.createElement('li');

    const left = document.createElement('span');
    const badge = document.createElement('span');
    badge.className = 'qty-badge';
    badge.textContent = `${qty}×`;
    left.append(badge, document.createTextNode(m.name));
    li.appendChild(left);

    if (withPrices) {
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = money(m.price * qty);
      li.appendChild(amount);
    }
    node.appendChild(li);
  }
}

function renderReview() {
  fillRecap('recapPot', STEPS[1]);
  fillRecap('recapMain', STEPS[2]);
  fillRecap('recapDessert', STEPS[3]);
  fillRecap('recapDrinks', STEPS[4], false);
  el('recapTotal').textContent = money(foodTotal());

  const box = el('sentNotice');
  box.textContent = '';
  if (state.submitted) {
    const n = document.createElement('p');
    n.className = 'notice';
    n.textContent = 'Sent. Moses has your order.';
    box.appendChild(n);
  }
}

/* ---------------- navigation ---------------- */

function navCopy() {
  const step = STEPS[state.step];
  const next = el('nextBtn');
  const context = el('navContext');

  el('backBtn').hidden = state.step === 0;

  if (state.step === 0) {
    next.textContent = 'Start';
    context.textContent = '';
  } else if (state.step === LAST) {
    next.textContent = state.submitted
      ? 'Update my order'
      : `Send to ${state.rules.host_name}`;
    context.textContent = `${money(foodTotal())} of yours`;
  } else {
    const picked = pickedIn(step);
    next.textContent = picked ? 'Next' : `Skip ${step.label.toLowerCase()}`;

    if (step.bucket === 'pot') context.textContent = `${money(potRemaining())} left in pot`;
    else if (step.bucket === 'food') context.textContent = `${money(foodRemaining())} left`;
    else context.textContent = `${cocktailCount()} of ${state.rules.cocktail_cap} picked`;
  }

  next.disabled = state.step === LAST && state.rules.locked;
}

function goto(n) {
  state.step = Math.max(0, Math.min(LAST, n));
  state.furthest = Math.max(state.furthest, state.step);

  document.querySelectorAll('.step').forEach((s) => {
    s.classList.toggle('active', Number(s.dataset.step) === state.step);
  });

  if (state.step === LAST) renderReview();
  renderRail();
  navCopy();

  const behaviour = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.scrollTo({ top: 0, behavior: behaviour });
}

/* ---------------- actions ---------------- */

function change(item, step, delta) {
  const counts = bucketOf(step.bucket);
  const next = (counts[item.id] || 0) + delta;

  if (next <= 0) delete counts[item.id];
  else counts[item.id] = Math.min(next, 10);

  // Immediate local feedback; the server still owns every cap.
  if (delta > 0) {
    const overFood = step.bucket === 'food' && foodTotal() > Number(state.rules.food_cap);
    const overPot =
      step.bucket === 'pot' && state.potUsedByOthers + potMine() > Number(state.rules.pot_cap);

    if (overFood || overPot) {
      counts[item.id] -= 1;
      if (!counts[item.id]) delete counts[item.id];
      toast(overPot ? 'The table pot is empty.' : `That goes over your ${money(state.rules.food_cap)}.`, 'err');
      return;
    }
  }

  renderAllLists();
  renderGauges();
  navCopy();
  queueSave();
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(false), 700);
}

function absorb(res) {
  state.submitted = Boolean(res.order.submitted_at);
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
    absorb(res);
    renderGauges();
    if (submit) toast('Order sent 🎉', 'ok');
    return true;
  } catch (err) {
    if (String(err?.message ?? '').includes('pot_full')) {
      await resync();
      toast('Someone just took the last of the pot. Adjusted.', 'err');
    } else {
      toast(friendlyError(err), 'err');
    }
    return false;
  }
}

async function resync() {
  try {
    const mine = await rpc('bday_get_guest', { p_token: TOKEN });
    state.pot = toCounts(mine.order.pot_lines);
    absorb(mine);
    renderAllLists();
    renderGauges();
    navCopy();
  } catch { /* keep the last known good state on screen */ }
}

/* ---------------- boot ---------------- */

function fail(msg) {
  el('loading').hidden = true;
  el('failed').hidden = false;
  el('failedMsg').textContent = msg;
}

async function boot() {
  if (!TOKEN) {
    fail('You need your own invite link. Ask Moses to send yours over.');
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
    absorb(mine);

    const r = state.rules;
    const when = new Date(r.event_date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });

    el('guestName').textContent = mine.guest.name;
    el('venueLine').textContent = r.venue;
    el('bkWhen').textContent = `${when}, ${r.event_time}`;
    el('bkTable').textContent = 'Table of 6';
    el('bkWhere').textContent = r.address;

    el('briefPot').textContent = `${money(r.pot_cap)} shared`;
    el('briefFood').textContent = `${money(r.food_cap)} each`;
    el('briefCk').textContent = `${r.cocktail_cap} each`;

    // The celebrant is also the host, so the drinks copy can't say "on Moses" to Moses.
    const celebrant = Boolean(mine.guest.celebrant);
    el('briefDrinkTitle').textContent = celebrant
      ? 'Drinks are on you'
      : `Drinks are on ${r.host_name}`;
    el('briefDrinkBody').textContent = celebrant
      ? "It's your day. Pick your first two."
      : `Pick your first two now. Want more at the table? ${r.host_name} has it.`;

    el('drinkLede').textContent =
      `Pick up to ${r.cocktail_cap}. These don't come out of your food budget.`;

    el('helloLead').textContent = celebrant ? 'Happy birthday,' : 'Hey';
    document.title = `${mine.guest.name} — pick your food`;

    if (state.rules.locked) {
      const n = document.createElement('p');
      n.className = 'notice warn';
      n.textContent = 'Orders are locked in. Talk to Moses if you need a change.';
      el('lockNotice').appendChild(n);
    }

    // Someone mid-way through comes back to where they were useful, not to step 1.
    if (mine.order.submitted_at) state.furthest = LAST;

    el('loading').hidden = true;
    el('app').hidden = false;
    el('rail').hidden = false;
    el('nav').hidden = false;

    renderAllLists();
    renderGauges();
    goto(0);
  } catch (err) {
    fail(friendlyError(err));
  }
}

el('backBtn').onclick = () => goto(state.step - 1);

el('nextBtn').onclick = async () => {
  if (state.step < LAST) {
    if (state.step === 0) await resync(); // fresh pot figure before they spend from it
    goto(state.step + 1);
    return;
  }

  const btn = el('nextBtn');
  btn.dataset.busy = 'true';
  btn.textContent = 'Sending…';
  clearTimeout(saveTimer);

  const ok = await save(true);

  delete btn.dataset.busy;
  renderReview();
  navCopy();
  if (!ok) btn.textContent = 'Try again';
};

document.querySelectorAll('.recap-edit').forEach((btn) => {
  btn.onclick = () => goto(Number(btn.dataset.goto));
});

boot();
