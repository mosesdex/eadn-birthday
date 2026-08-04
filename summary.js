import { rpc, money, param, friendlyError } from './api.js';

const HOST = param('h');
const el = (id) => document.getElementById(id);

let data = null;

/* ---------------- small builders ---------------- */

function cell(text, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
}

function row(cells) {
  const tr = document.createElement('tr');
  cells.forEach((c) => tr.appendChild(c));
  return tr;
}

const num = (v) => cell(money(v), 'num');

/* ---------------- the money ---------------- */

function renderLedger() {
  const r = data.rules;
  const guests = data.guests.length || 1;

  const personalBudget = Number(r.food_cap) * guests;
  const personalSpent = Number(data.table_food_total);
  const potBudget = Number(r.pot_cap);
  const potSpent = Number(data.pot_used);
  const barSpent = Number(data.bar_total);

  const body = el('ledgerBody');
  body.textContent = '';

  const lines = [
    ['Own plates', `${guests} × ${money(r.food_cap)}`, personalBudget, personalSpent],
    ['Shared dishes', `${guests} × ${money(r.pot_per_guest)}`, potBudget, potSpent],
  ];

  for (const [label, sub, budget, spent] of lines) {
    const name = document.createElement('td');
    name.appendChild(document.createTextNode(label));
    const small = document.createElement('div');
    small.className = 'course';
    small.textContent = sub;
    name.appendChild(small);

    const left = budget - spent;
    const leftCell = cell(money(left), `num ${left < 0 ? 'over' : 'dim'}`);
    body.appendChild(row([name, num(budget), num(spent), leftCell]));
  }

  // Cocktails are uncapped in money terms — only the count per guest is limited.
  const barName = document.createElement('td');
  barName.appendChild(document.createTextNode('Cocktails'));
  const barSub = document.createElement('div');
  barSub.className = 'course';
  barSub.textContent = `up to ${r.cocktail_cap} each, on ${r.host_name}`;
  barName.appendChild(barSub);
  body.appendChild(row([barName, cell('—', 'num dim'), num(barSpent), cell('—', 'num dim')]));

  const foodTotal = personalSpent + potSpent;
  const grand = foodTotal + barSpent;

  const foot = el('ledgerFoot');
  foot.textContent = '';

  const label = document.createElement('td');
  label.textContent = 'Food committed';
  foot.appendChild(row([
    label,
    num(Number(r.table_cap)),
    num(foodTotal),
    cell(money(Number(r.table_cap) - foodTotal), `num ${foodTotal > Number(r.table_cap) ? 'over' : 'under'}`),
  ]));

  const grandLabel = document.createElement('td');
  grandLabel.textContent = 'With cocktails';
  const blank = cell('', 'num');
  foot.appendChild(row([grandLabel, blank, num(grand), cell('', 'num')]));

  const submitted = data.guests.filter((g) => g.submitted_at).length;
  el('moneyNote').textContent =
    submitted === data.guests.length
      ? 'All six orders are in. These are final figures, before service charge.'
      : `${submitted} of ${data.guests.length} orders submitted. Figures will rise as the rest come in. Excludes service charge.`;
}

/* ---------------- per guest ---------------- */

function courseBlock(title, lines, withPrices = true) {
  if (!lines.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'course-block';

  const label = document.createElement('p');
  label.className = 'course-label';
  label.textContent = title;
  wrap.appendChild(label);

  const ul = document.createElement('ul');
  ul.className = 'course-list';

  for (const line of lines) {
    const li = document.createElement('li');

    const left = document.createElement('span');
    const badge = document.createElement('span');
    badge.className = 'qty-badge';
    badge.textContent = `${line.qty}×`;
    left.append(badge, document.createTextNode(line.name));
    li.appendChild(left);

    if (withPrices) {
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = money(line.line_total);
      li.appendChild(amount);
    }
    ul.appendChild(li);
  }

  wrap.appendChild(ul);
  return wrap;
}

function renderGuests() {
  const wrap = el('guestSheets');
  wrap.textContent = '';

  for (const g of data.guests) {
    const block = document.createElement('div');
    block.className = 'sheet-guest';

    const head = document.createElement('div');
    head.className = 'sheet-guest-head';

    const seat = document.createElement('span');
    seat.className = 'seat-no';
    seat.textContent = String(g.seat).padStart(2, '0');

    const name = document.createElement('h3');
    name.textContent = g.name;

    const status = document.createElement('span');
    if (g.submitted_at) {
      status.className = 'pill done';
      status.textContent = 'Submitted';
    } else if (Number(g.guest_total) > 0) {
      status.className = 'pill draft';
      status.textContent = 'In progress';
    } else {
      status.className = 'pill';
      status.textContent = 'Not started';
    }

    const spend = document.createElement('span');
    spend.className = 'spend';
    spend.textContent = money(g.guest_total);

    head.append(seat, name, status, spend);
    block.appendChild(head);

    const blocks = [
      courseBlock('For the middle', g.pot_lines),
      courseBlock('Own plate', g.food_lines),
      courseBlock('Drinks', g.cocktail_lines, false),
    ].filter(Boolean);

    if (blocks.length) blocks.forEach((b) => block.appendChild(b));
    else {
      const nothing = document.createElement('p');
      nothing.className = 'nothing';
      nothing.textContent = 'Has not chosen anything yet.';
      block.appendChild(nothing);
    }

    wrap.appendChild(block);
  }
}

/* ---------------- kitchen and bar ---------------- */

function renderKitchen() {
  const body = el('kitchenBody');
  const foot = el('kitchenFoot');
  body.textContent = '';
  foot.textContent = '';

  if (!data.kitchen.length) {
    const td = cell('Nothing ordered yet.', 'dim');
    td.colSpan = 4;
    body.appendChild(row([td]));
    return;
  }

  for (const k of data.kitchen) {
    const course = k.shared ? `${k.section} · shared` : k.section;
    body.appendChild(row([
      cell(String(k.qty), 'num narrow'),
      cell(k.name),
      cell(course, 'course'),
      num(k.line_total),
    ]));
  }

  const total = data.kitchen.reduce((s, k) => s + Number(k.line_total), 0);
  const plates = data.kitchen.reduce((s, k) => s + Number(k.qty), 0);
  const label = cell(`${plates} plates`);
  label.colSpan = 3;
  foot.appendChild(row([label, num(total)]));
}

/* Which guests picked a given cocktail, so the bar knows where it goes. */
function drinkersOf(name) {
  return data.guests
    .filter((g) => g.cocktail_lines.some((l) => l.name === name))
    .map((g) => g.name)
    .join(', ');
}

function renderBar() {
  const body = el('barBody');
  const foot = el('barFoot');
  body.textContent = '';
  foot.textContent = '';

  if (!data.bar.length) {
    const td = cell('No cocktails chosen yet.', 'dim');
    td.colSpan = 4;
    body.appendChild(row([td]));
    return;
  }

  for (const b of data.bar) {
    body.appendChild(row([
      cell(String(b.qty), 'num narrow'),
      cell(b.name),
      cell(drinkersOf(b.name), 'course'),
      num(b.line_total),
    ]));
  }

  const drinks = data.bar.reduce((s, b) => s + Number(b.qty), 0);
  const label = cell(`${drinks} drinks`);
  label.colSpan = 3;
  foot.appendChild(row([label, num(data.bar_total)]));
}

/* ---------------- plain text, for pasting into a message ---------------- */

function asText() {
  const r = data.rules;
  const out = [
    `${r.event_name} — ${r.venue}`,
    `${r.event_date} at ${r.event_time} · table of ${data.guests.length}`,
    '',
    'FOR THE KITCHEN',
    ...data.kitchen.map((k) => `  ${k.qty}x ${k.name}${k.shared ? ' (shared)' : ''}  ${money(k.line_total)}`),
  ];

  if (data.bar.length) {
    out.push('', 'FOR THE BAR',
      ...data.bar.map((b) => `  ${b.qty}x ${b.name}  ${money(b.line_total)}`));
  }

  out.push('', 'BY GUEST');
  for (const g of data.guests) {
    out.push(`  ${g.name} — ${money(g.guest_total)}`);
    for (const l of [...g.pot_lines, ...g.food_lines]) out.push(`     ${l.qty}x ${l.name}`);
    for (const l of g.cocktail_lines) out.push(`     ${l.qty}x ${l.name} (drink)`);
  }

  const food = Number(data.table_food_total) + Number(data.pot_used);
  out.push('',
    `Food:      ${money(food)}`,
    `Cocktails: ${money(data.bar_total)}`,
    `Total:     ${money(food + Number(data.bar_total))}`,
    '(before service charge)');

  return out.join('\n');
}

/* ---------------- boot ---------------- */

async function load() {
  try {
    data = await rpc('bday_host_summary', { p_host_token: HOST });

    const r = data.rules;
    const when = new Date(r.event_date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    document.title = `Full order — ${r.venue}`;
    el('docTitle').textContent = r.event_name;
    el('docMeta').textContent = `${r.venue} · ${when}, ${r.event_time} · table of ${data.guests.length}`;
    el('docAddress').textContent = `${r.address} · ${r.phone}`;
    el('docStamp').textContent = `Prepared ${new Date().toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })}`;
    el('backLink').href = `host.html?h=${encodeURIComponent(HOST)}`;
    el('docFoot').textContent =
      `Prices are EADN's published menu prices. Service charge not included. ${r.host_name} settles the bill.`;

    renderLedger();
    renderGuests();
    renderKitchen();
    renderBar();

    el('loading').hidden = true;
    el('app').hidden = false;
  } catch (err) {
    el('loading').hidden = true;
    el('failed').hidden = false;
    el('failedMsg').textContent = friendlyError(err);
  }
}

el('printBtn').onclick = () => window.print();

el('copyBtn').onclick = async (e) => {
  await navigator.clipboard.writeText(asText());
  const btn = e.currentTarget;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
};

if (!HOST) {
  el('loading').hidden = true;
  el('failed').hidden = false;
  el('failedMsg').textContent = 'This page needs the host key.';
} else {
  load();
}
