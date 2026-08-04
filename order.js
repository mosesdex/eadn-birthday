import { rpc, money, param, toLines, toCounts, friendlyError } from './api.js';

const TOKEN = param('t');
const FOOD_ORDER = ['Small Plates', 'Large Plates', 'Sides', 'Desserts'];

const el = (id) => document.getElementById(id);
const state = { menu: [], rules: null, food: {}, cocktails: {}, submitted: false };

let saveTimer = null;
let toastTimer = null;

/* ---------------- helpers ---------------- */

const foodTotal = () =>
  state.menu.reduce((sum, m) => sum + (m.kind === 'food' ? m.price * (state.food[m.id] || 0) : 0), 0);

const cocktailCount = () =>
  Object.values(state.cocktails).reduce((a, b) => a + b, 0);

function toast(msg, kind = '') {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = msg;
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

const cacheKey = () => `bday_draft_${TOKEN}`;

function cacheDraft() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ food: state.food, cocktails: state.cocktails }));
  } catch { /* private browsing — the server copy is the real one */ }
}

/* ---------------- rendering ---------------- */

function renderBudget() {
  const cap = Number(state.rules.food_cap);
  const total = foodTotal();
  const left = Math.max(0, cap - total);
  const ratio = cap > 0 ? Math.min(1, total / cap) : 0;

  el('budgetLeft').textContent = `${money(left)} left`;
  el('budgetCap').textContent = `${money(total)} of ${money(cap)}`;
  el('footTotal').textContent = money(total);
  el('meterFill').style.transform = `scaleX(${ratio})`;

  const meter = el('meter');
  meter.classList.toggle('warn', ratio >= 0.78 && ratio < 1);
  meter.classList.toggle('full', ratio >= 1);
}

function itemRow(m) {
  const isFood = m.kind === 'food';
  const counts = isFood ? state.food : state.cocktails;
  const qty = counts[m.id] || 0;

  const remaining = Number(state.rules.food_cap) - foodTotal();
  const blocked = isFood
    ? m.price > remaining
    : cocktailCount() >= Number(state.rules.cocktail_cap);

  const row = document.createElement('div');
  row.className = `item${qty > 0 ? ' picked' : ''}${blocked && qty === 0 ? ' blocked' : ''}`;

  const main = document.createElement('div');
  main.className = 'item-main';

  const name = document.createElement('div');
  name.className = 'item-name';
  name.textContent = m.name;
  main.appendChild(name);

  if (m.description) {
    const desc = document.createElement('div');
    desc.className = 'item-desc';
    desc.textContent = m.description;
    main.appendChild(desc);
  }
  if (m.note) {
    const note = document.createElement('span');
    note.className = 'item-note';
    note.textContent = m.note;
    main.appendChild(note);
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

function render() {
  const foodWrap = el('foodSections');
  foodWrap.textContent = '';

  for (const section of FOOD_ORDER) {
    const items = state.menu.filter((m) => m.kind === 'food' && m.section === section);
    if (!items.length) continue;

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = section;
    foodWrap.appendChild(title);
    items.forEach((m) => foodWrap.appendChild(itemRow(m)));
  }

  const ckWrap = el('cocktailList');
  ckWrap.textContent = '';
  state.menu.filter((m) => m.kind === 'cocktail').forEach((m) => ckWrap.appendChild(itemRow(m)));

  el('ckCap').textContent = state.rules.cocktail_cap;
  renderBudget();
  renderStatus();
}

function renderStatus() {
  const box = el('statusBanner');
  box.textContent = '';

  if (state.rules.locked) {
    const b = document.createElement('div');
    b.className = 'banner warn';
    b.textContent = 'Orders are locked in. Talk to Dex if you need a change.';
    box.appendChild(b);
    return;
  }
  if (state.submitted) {
    const b = document.createElement('div');
    b.className = 'banner';
    b.textContent = "You're in. Dex has your order. Change it any time before Thursday.";
    box.appendChild(b);
  }
}

/* ---------------- actions ---------------- */

function change(item, delta) {
  const counts = item.kind === 'food' ? state.food : state.cocktails;
  const next = (counts[item.id] || 0) + delta;

  if (next <= 0) delete counts[item.id];
  else counts[item.id] = Math.min(next, 10);

  // The server is authoritative on the caps; this is just fast feedback.
  if (item.kind === 'food' && foodTotal() > Number(state.rules.food_cap)) {
    if (delta > 0) counts[item.id] = (counts[item.id] || 1) - 1;
    if (!counts[item.id]) delete counts[item.id];
    toast(`That would go over your ${money(state.rules.food_cap)}.`, 'err');
    return;
  }

  cacheDraft();
  render();
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
      p_cocktails: toLines(state.cocktails),
      p_submit: submit,
    });
    state.submitted = Boolean(res.order.submitted_at);
    renderStatus();
    if (submit) toast('Order sent to Dex 🎉', 'ok');
    return true;
  } catch (err) {
    toast(friendlyError(err), 'err');
    return false;
  }
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
    state.cocktails = toCounts(mine.order.cocktail_lines);
    state.submitted = Boolean(mine.order.submitted_at);

    el('eventName').textContent = state.rules.event_name;
    el('venue').textContent = state.rules.venue;
    el('eventDate').textContent = new Date(state.rules.event_date + 'T00:00:00').toLocaleDateString(
      'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long' },
    );
    el('guestName').textContent = mine.guest.name;
    document.title = `${mine.guest.name} — pick your food`;

    el('state').hidden = true;
    el('app').hidden = false;
    el('budgetBar').hidden = false;
    el('footbar').hidden = false;

    if (state.rules.locked) {
      el('submitBtn').disabled = true;
      el('submitBtn').textContent = 'Locked';
    }

    render();
  } catch (err) {
    el('state').textContent = friendlyError(err);
  }
}

el('submitBtn').onclick = async () => {
  const btn = el('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  clearTimeout(saveTimer);
  const ok = await save(true);
  btn.disabled = state.rules?.locked ?? false;
  btn.textContent = ok ? 'Update order' : 'Submit order';
};

boot();
