import { rpc, param, toLines, toCounts, friendlyError } from './api.js';

const TOKEN = param('t');

/* Each picking step declares which menu sections it owns and which allowance
   those items are charged to. Adding a step is a one-line change. */
const STEPS = [
  { id: 'welcome', label: 'Start' },
  { id: 'table', label: 'Table', bucket: 'pot', sections: ['Small Plates', 'Sides'], list: 'listPot' },
  { id: 'main', label: 'Main', bucket: 'food', sections: ['Large Plates'], list: 'listMain' },
  { id: 'dessert', label: 'Sweet', bucket: 'food', sections: ['Desserts'], list: 'listDessert' },
  { id: 'drinks', label: 'Drinks', bucket: 'cocktails', kind: 'cocktail', list: 'listDrinks' },
  { id: 'review', label: 'Review' },
];

const LAST = STEPS.length - 1;
const el = (id) => document.getElementById(id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const state = {
  menu: [],
  rules: null,
  step: 0,
  furthest: 0,
  food: {},
  pot: {},
  cocktails: {},
  submitted: false,
};

let saveTimer = null;
let toastTimer = null;

/* ---------------- allowances ----------------
   Guests never see these figures. They exist only to decide what can still
   be added; the server re-checks every one of them on save. */

const priceOf = (id) => state.menu.find((m) => m.id === id)?.price ?? 0;
const sumOf = (counts) => Object.entries(counts).reduce((t, [id, q]) => t + priceOf(id) * q, 0);
const countOf = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

const foodLeft = () => Number(state.rules.food_cap) - sumOf(state.food);
const potLeft = () => Number(state.rules.pot_per_guest) - sumOf(state.pot);
const potItemsLeft = () => Number(state.rules.pot_item_cap) - countOf(state.pot);
const cocktailsLeft = () => Number(state.rules.cocktail_cap) - countOf(state.cocktails);

const hasFood = () => countOf(state.food) + countOf(state.pot) > 0;

const bucketOf = (name) =>
  name === 'pot' ? state.pot : name === 'food' ? state.food : state.cocktails;

function itemsFor(step) {
  if (step.kind === 'cocktail') return state.menu.filter((m) => m.kind === 'cocktail');
  if (!step.sections) return [];
  return state.menu.filter((m) => m.kind === 'food' && step.sections.includes(m.section));
}

const pickedIn = (step) => countOf(
  Object.fromEntries(
    itemsFor(step).map((m) => [m.id, bucketOf(step.bucket)[m.id] || 0]),
  ),
);

/* Why an item can't be added, in words rather than money. */
function blockReason(item, step) {
  if (step.kind === 'cocktail') {
    return cocktailsLeft() <= 0 ? `That's your ${state.rules.cocktail_cap}.` : null;
  }
  if (step.bucket === 'pot') {
    if (potItemsLeft() <= 0) return "That's plenty for the middle.";
    return item.price > potLeft() ? 'Too much alongside your other pick.' : null;
  }
  return item.price > foodLeft() ? "Won't fit with your main." : null;
}

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
    btn.disabled = i > state.furthest;
    btn.onclick = () => goto(i);
    wrap.appendChild(btn);
  });
}

/* ---------------- items ---------------- */

function itemRow(m, step) {
  const counts = bucketOf(step.bucket);
  const qty = counts[m.id] || 0;
  const reason = qty === 0 ? blockReason(m, step) : null;

  const row = document.createElement('div');
  row.className = `item${qty > 0 ? ' picked' : ''}${reason ? ' blocked' : ''}`;

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

  if (reason) {
    const why = document.createElement('p');
    why.className = 'item-why';
    why.textContent = reason;
    main.appendChild(why);
  }

  const controls = document.createElement('div');
  controls.className = 'item-controls';

  if (state.rules.show_prices) {
    const price = document.createElement('span');
    price.className = 'item-price';
    price.textContent = `£${Number(m.price).toFixed(2)}`;
    controls.appendChild(price);
  }

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
  plus.disabled = Boolean(reason);
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

/* Counts, never amounts. */
function renderTallies() {
  const potMax = Number(state.rules.pot_item_cap);
  const potPicked = countOf(state.pot);
  el('potTally').textContent = potPicked
    ? `${potPicked} of ${potMax} chosen`
    : `Choose up to ${potMax}`;

  const ckMax = Number(state.rules.cocktail_cap);
  const ckPicked = countOf(state.cocktails);
  el('ckTally').textContent = ckPicked
    ? `${ckPicked} of ${ckMax} chosen`
    : `Choose up to ${ckMax}`;
}

/* ---------------- review ---------------- */

function fillRecap(nodeId, step) {
  const node = el(nodeId);
  node.textContent = '';

  const counts = bucketOf(step.bucket);
  const rows = itemsFor(step)
    .map((m) => [m, counts[m.id] || 0])
    .filter(([, q]) => q > 0);

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'recap-empty';
    li.textContent = 'Nothing chosen.';
    node.appendChild(li);
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
    node.appendChild(li);
  }
}

function renderReview() {
  fillRecap('recapPot', STEPS[1]);
  fillRecap('recapMain', STEPS[2]);
  fillRecap('recapDessert', STEPS[3]);
  fillRecap('recapDrinks', STEPS[4]);

  const box = el('sentNotice');
  box.textContent = '';

  if (!hasFood()) {
    const n = document.createElement('p');
    n.className = 'notice warn';
    n.textContent = 'Pick at least one thing to eat before you send this over.';
    box.appendChild(n);

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'btn sm ghost';
    jump.textContent = 'Choose a main';
    jump.onclick = () => goto(2);
    box.appendChild(jump);
    return;
  }

  if (state.submitted) {
    const n = document.createElement('p');
    n.className = 'notice';
    n.textContent = `Sent. Your order is in with ${state.rules.venue}.`;
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
      : `Send to ${state.rules.venue}`;
    context.textContent = hasFood() ? '' : 'Nothing chosen yet';
  } else {
    const picked = pickedIn(step);
    next.textContent = picked ? 'Next' : `Skip ${step.label.toLowerCase()}`;

    if (step.bucket === 'pot') {
      context.textContent = plural(Math.max(0, potItemsLeft()), 'pick left', 'picks left');
    } else if (step.bucket === 'cocktails') {
      context.textContent = plural(Math.max(0, cocktailsLeft()), 'drink left', 'drinks left');
    } else {
      context.textContent = picked ? plural(picked, 'chosen', 'chosen') : '';
    }
  }

  next.disabled = state.step === LAST && (state.rules.locked || !hasFood());
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

  // Local guard for instant feedback; the server owns every limit.
  if (delta > 0) {
    const broke =
      (step.bucket === 'food' && foodLeft() < 0) ||
      (step.bucket === 'pot' && (potLeft() < 0 || potItemsLeft() < 0)) ||
      (step.bucket === 'cocktails' && cocktailsLeft() < 0);

    if (broke) {
      counts[item.id] -= 1;
      if (!counts[item.id]) delete counts[item.id];
      toast('Remove something first to add that.', 'err');
      return;
    }
  }

  renderAllLists();
  renderTallies();
  navCopy();
  queueSave();
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(false), 700);
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
    state.submitted = Boolean(res.order.submitted_at);
    if (submit) toast('Order sent', 'ok');
    return true;
  } catch (err) {
    toast(friendlyError(err), 'err');
    return false;
  }
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
    state.submitted = Boolean(mine.order.submitted_at);

    const r = state.rules;
    const when = new Date(r.event_date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });

    el('guestName').textContent = mine.guest.name;
    el('helloLead').textContent = mine.guest.celebrant ? 'Happy birthday,' : 'Hey';
    el('venueLine').textContent = r.venue;
    el('bkWhen').textContent = `${when}, ${r.event_time}`;
    el('bkTable').textContent = 'Table of 6';
    el('bkWhere').textContent = r.address;

    el('briefPot').textContent = `Up to ${r.pot_item_cap}`;
    el('briefCk').textContent = `Up to ${r.cocktail_cap}`;
    el('potLede').textContent =
      `Everyone picks a couple of things for the centre of the table, so choose up to ${r.pot_item_cap} you'd want to share.`;
    el('drinkLede').textContent =
      `Pick up to ${r.cocktail_cap} to start the night. Plenty more at the table after that.`;

    document.title = `${mine.guest.name} — pick your food`;

    if (r.locked) {
      const n = document.createElement('p');
      n.className = 'notice warn';
      n.textContent = `Orders are locked in. Talk to ${r.host_name} if you need a change.`;
      el('lockNotice').appendChild(n);
    }

    if (mine.order.submitted_at) state.furthest = LAST;

    el('loading').hidden = true;
    el('app').hidden = false;
    el('rail').hidden = false;
    el('nav').hidden = false;

    renderAllLists();
    renderTallies();
    goto(0);
  } catch (err) {
    fail(friendlyError(err));
  }
}

el('backBtn').onclick = () => goto(state.step - 1);

el('nextBtn').onclick = async () => {
  if (state.step < LAST) {
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
