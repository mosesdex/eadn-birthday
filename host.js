import { rpc, money, param, friendlyError } from './api.js';

const HOST = param('h');
const el = (id) => document.getElementById(id);

let data = null;
let toastTimer = null;

function toast(msg, kind = '') {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = msg;
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 3000);
}

const guestLink = (token) =>
  `${location.origin}${location.pathname.replace(/host\.html$/, '')}order.html?t=${token}`;

function lineItem(line, showMoney = true) {
  const li = document.createElement('li');
  const left = document.createElement('span');

  const badge = document.createElement('span');
  badge.className = 'qty-badge';
  badge.textContent = `${line.qty}×`;
  left.append(badge, document.createTextNode(line.name));

  li.appendChild(left);
  if (showMoney) {
    const right = document.createElement('span');
    right.textContent = money(line.line_total);
    li.appendChild(right);
  }
  return li;
}

function renderStats() {
  const total = Number(data.table_food_total);
  const cap = Number(data.rules.table_cap);
  const submitted = data.guests.filter((g) => g.submitted_at).length;
  const barTotal = data.bar.reduce((s, b) => s + Number(b.line_total), 0);

  el('statTotal').textContent = money(total);
  el('statTotal').classList.toggle('over', total > cap);
  el('statCap').textContent = money(cap);
  el('statSubmitted').textContent = `${submitted} / ${data.guests.length}`;
  el('statCocktails').textContent = money(barTotal);
}

function renderLock() {
  const box = el('lockBanner');
  box.textContent = '';
  el('lockBtn').textContent = data.rules.locked ? 'Unlock orders' : 'Lock orders';

  if (data.rules.locked) {
    const b = document.createElement('div');
    b.className = 'banner warn';
    b.textContent = 'Orders are locked. Guests can no longer change their picks.';
    box.appendChild(b);
  }
}

function renderKitchen() {
  const list = el('kitchenList');
  list.textContent = '';

  if (!data.kitchen.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Nothing ordered yet.';
    list.appendChild(li);
    return;
  }
  data.kitchen.forEach((line) => list.appendChild(lineItem(line)));
}

function renderBar() {
  const list = el('barList');
  list.textContent = '';

  if (!data.bar.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No cocktails picked yet.';
    list.appendChild(li);
    return;
  }
  data.bar.forEach((line) => list.appendChild(lineItem(line)));
}

function renderGuests() {
  const wrap = el('guestList');
  wrap.textContent = '';

  for (const g of data.guests) {
    const card = document.createElement('div');
    card.className = 'guest';

    const head = document.createElement('div');
    head.className = 'guest-head';

    const nameInput = document.createElement('input');
    nameInput.className = 'guest-name';
    nameInput.value = g.name;
    nameInput.maxLength = 40;
    nameInput.setAttribute('aria-label', `Name for seat ${g.seat}`);
    nameInput.onchange = async () => {
      try {
        data = await rpc('bday_host_rename_guest', {
          p_host_token: HOST,
          p_guest_id: g.id,
          p_name: nameInput.value,
        });
        renderAll();
        toast('Name saved', 'ok');
      } catch (err) {
        toast(friendlyError(err), 'err');
      }
    };

    const pill = document.createElement('span');
    if (g.submitted_at) {
      pill.className = 'pill done';
      pill.textContent = 'Submitted';
    } else if (Number(g.food_total) > 0) {
      pill.className = 'pill draft';
      pill.textContent = 'In progress';
    } else {
      pill.className = 'pill';
      pill.textContent = 'Not started';
    }

    const spend = document.createElement('span');
    spend.className = 'pill';
    spend.textContent = money(g.food_total);

    head.append(nameInput, pill, spend);
    card.appendChild(head);

    if (g.food_lines.length || g.cocktail_lines.length) {
      const lines = document.createElement('ul');
      lines.className = 'lines';
      g.food_lines.forEach((l) => lines.appendChild(lineItem(l)));
      g.cocktail_lines.forEach((l) => {
        const li = lineItem(l, false);
        li.style.color = 'var(--gold-soft)';
        lines.appendChild(li);
      });
      card.appendChild(lines);
    }

    const row = document.createElement('div');
    row.className = 'link-row';

    const link = document.createElement('input');
    link.readOnly = true;
    link.value = guestLink(g.token);
    link.setAttribute('aria-label', `Invite link for ${g.name}`);
    link.onclick = () => link.select();

    const copy = document.createElement('button');
    copy.className = 'btn small ghost';
    copy.textContent = 'Copy';
    copy.onclick = async () => {
      await navigator.clipboard.writeText(guestLink(g.token));
      toast(`Link for ${g.name} copied`, 'ok');
    };

    row.append(link, copy);
    card.appendChild(row);
    wrap.appendChild(card);
  }
}

function orderAsText() {
  const lines = [
    `${data.rules.event_name} — ${data.rules.venue}`,
    `Table of ${data.guests.length}`,
    '',
    'FOOD',
    ...data.kitchen.map((k) => `${k.qty}x ${k.name}  (${money(k.line_total)})`),
    '',
    `Food total: ${money(data.table_food_total)}`,
  ];

  if (data.bar.length) {
    lines.push('', 'COCKTAILS (on the host)', ...data.bar.map((b) => `${b.qty}x ${b.name}`));
  }
  return lines.join('\n');
}

function renderAll() {
  renderStats();
  renderLock();
  renderKitchen();
  renderBar();
  renderGuests();
}

async function load(quiet = false) {
  try {
    data = await rpc('bday_host_summary', { p_host_token: HOST });

    el('eventName').textContent = data.rules.event_name;
    el('eventDate').textContent = new Date(data.rules.event_date + 'T00:00:00').toLocaleDateString(
      'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long' },
    );

    el('state').hidden = true;
    el('app').hidden = false;
    renderAll();
  } catch (err) {
    if (!quiet) el('state').textContent = friendlyError(err);
  }
}

el('refreshBtn').onclick = () => load();

el('copyOrder').onclick = async () => {
  await navigator.clipboard.writeText(orderAsText());
  toast('Order copied', 'ok');
};

el('lockBtn').onclick = async () => {
  try {
    data = await rpc('bday_host_set_lock', { p_host_token: HOST, p_locked: !data.rules.locked });
    renderAll();
    toast(data.rules.locked ? 'Orders locked' : 'Orders unlocked', 'ok');
  } catch (err) {
    toast(friendlyError(err), 'err');
  }
};

if (!HOST) {
  el('state').textContent = 'Host link is missing its key.';
} else {
  load();
  setInterval(() => load(true), 15000);
}
