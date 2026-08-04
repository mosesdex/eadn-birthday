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
  node.setAttribute('role', 'status');
  node.textContent = msg;
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 3000);
}

/* The name is cosmetic: it rides in the URL so six near-identical links are
   tellable apart in a chat window. Auth is the token alone; `for` is ignored
   by every RPC, so editing it changes nothing. */
const slug = (name) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const guestLink = (token, name) => {
  const base = `${location.origin}${location.pathname.replace(/host\.html$/, '')}order.html`;
  return `${base}?for=${slug(name)}&t=${token}`;
};

function lineItem(line, withPrice = true) {
  const li = document.createElement('li');

  const left = document.createElement('span');
  const badge = document.createElement('span');
  badge.className = 'qty-badge';
  badge.textContent = `${line.qty}×`;
  left.append(badge, document.createTextNode(line.name));
  li.appendChild(left);

  if (withPrice) {
    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = money(line.line_total);
    li.appendChild(amount);
  }
  return li;
}

function emptyLine(node, text) {
  const li = document.createElement('li');
  li.className = 'recap-empty';
  li.textContent = text;
  node.appendChild(li);
}

function renderStats() {
  const personal = Number(data.table_food_total);
  const pot = Number(data.pot_used);
  const total = personal + pot;
  const cap = Number(data.rules.table_cap);
  const potCap = Number(data.rules.pot_cap);
  const submitted = data.guests.filter((g) => g.submitted_at).length;
  const barTotal = data.bar.reduce((s, b) => s + Number(b.line_total), 0);

  el('statTotal').textContent = money(total);
  el('statTotal').classList.toggle('over', total > cap);
  el('statBreakdown').textContent = `${money(personal)} personal · ${money(pot)} pot`;

  el('statPot').textContent = `${money(pot)} / ${money(potCap)}`;
  el('statPot').classList.toggle('over', pot > potCap);

  el('statCap').textContent = money(cap);
  el('statSubmitted').textContent = `${submitted} / ${data.guests.length}`;
  el('statCocktails').textContent = money(barTotal);
}

function renderLock() {
  const box = el('lockNotice');
  box.textContent = '';
  el('lockBtn').textContent = data.rules.locked ? 'Unlock orders' : 'Lock orders';

  if (data.rules.locked) {
    const n = document.createElement('p');
    n.className = 'notice warn';
    n.textContent = 'Orders are locked. Guests can no longer change their picks.';
    box.appendChild(n);
  }
}

function renderKitchen() {
  const list = el('kitchenList');
  list.textContent = '';
  if (!data.kitchen.length) {
    emptyLine(list, 'Nothing ordered yet. Send the guest links out.');
    return;
  }
  data.kitchen.forEach((line) => list.appendChild(lineItem(line)));
}

function renderBar() {
  const list = el('barList');
  list.textContent = '';
  if (!data.bar.length) {
    emptyLine(list, 'No cocktails picked yet.');
    return;
  }
  data.bar.forEach((line) => list.appendChild(lineItem(line)));
}

function statusPill(g) {
  const pill = document.createElement('span');
  if (g.submitted_at) {
    pill.className = 'pill done';
    pill.textContent = 'Submitted';
  } else if (Number(g.food_total) + Number(g.pot_total) > 0) {
    pill.className = 'pill draft';
    pill.textContent = 'In progress';
  } else {
    pill.className = 'pill';
    pill.textContent = 'Not started';
  }
  return pill;
}

function renderGuests() {
  const wrap = el('guestList');
  wrap.textContent = '';

  for (const g of data.guests) {
    const card = document.createElement('div');
    card.className = 'panel';

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

    const own = document.createElement('span');
    own.className = 'pill';
    own.textContent = `${money(g.food_total)} own`;

    const pot = document.createElement('span');
    pot.className = 'pill';
    pot.textContent = `${money(g.pot_total)} pot`;

    head.append(nameInput, statusPill(g), own, pot);
    card.appendChild(head);

    const all = [
      ...g.food_lines.map((l) => [l, true]),
      ...g.pot_lines.map((l) => [l, true]),
      ...g.cocktail_lines.map((l) => [l, false]),
    ];

    if (all.length) {
      const lines = document.createElement('ul');
      lines.className = 'lines';
      all.forEach(([line, withPrice]) => lines.appendChild(lineItem(line, withPrice)));
      card.appendChild(lines);
    }

    const row = document.createElement('div');
    row.className = 'link-row';

    const link = document.createElement('input');
    link.readOnly = true;
    link.value = guestLink(g.token, g.name);
    link.setAttribute('aria-label', `Invite link for ${g.name}`);
    link.onclick = () => link.select();

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn sm ghost';
    copy.textContent = 'Copy';
    copy.onclick = async () => {
      await navigator.clipboard.writeText(guestLink(g.token, g.name));
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
    `Food total: ${money(Number(data.table_food_total) + Number(data.pot_used))}`,
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

    const when = new Date(data.rules.event_date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    el('eventName').textContent = data.rules.event_name;
    el('eventMeta').textContent = `${data.rules.venue} · ${when}`;
    el('fullOrderLink').href = `summary.html?h=${encodeURIComponent(HOST)}`;

    el('loading').hidden = true;
    el('failed').hidden = true;
    el('app').hidden = false;
    renderAll();
  } catch (err) {
    if (quiet) return;
    el('loading').hidden = true;
    el('failed').hidden = false;
    el('failedMsg').textContent = friendlyError(err);
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
  el('loading').hidden = true;
  el('failed').hidden = false;
  el('failedMsg').textContent = 'Host link is missing its key.';
} else {
  load();
  setInterval(() => load(true), 15000);
}
