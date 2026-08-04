import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Human-readable text for the errors bday_save_order can raise.
const ERRORS = {
  invalid_token: "That link isn't valid. Ask Moses to resend yours.",
  invalid_host_token: 'Host link is not valid.',
  orders_locked: 'Orders are locked in. Talk to Moses.',
  over_budget: "That won't fit alongside your main.",
  pot_share_spent: "That's too much alongside your other pick.",
  too_many_pot_items: "That's plenty for the middle.",
  too_many_cocktails: "That's all your drinks chosen.",
  unknown_food_item: "That one isn't on your own plate menu.",
  unknown_pot_item: "That one can't go in the table pot.",
  unknown_cocktail: "That cocktail isn't on the list.",
  bad_quantity: 'Invalid quantity.',
  nothing_chosen: 'Choose something to eat first.',
  one_per_course: 'Just one dish from each course.',
  both_courses_needed: 'Choose a starter and a main first.',
  bad_payload: 'Something went wrong with that order.',
  bad_name: 'Name must be 1-40 characters.',
};

export function friendlyError(err) {
  const raw = String(err?.message ?? err ?? '');
  for (const [code, text] of Object.entries(ERRORS)) {
    if (raw.includes(code)) return text;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

export async function rpc(fn, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(params),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.message || body?.hint || `HTTP ${res.status}`);
  }
  return body;
}

export const money = (n) => `£${Number(n || 0).toFixed(2)}`;

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

// Turn a {id: qty} map into the [{id, qty}] shape the RPCs expect.
export const toLines = (counts) =>
  Object.entries(counts)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ id, qty }));

// And back again, from the server's priced line items.
export const toCounts = (lines) =>
  Object.fromEntries((lines || []).map((l) => [l.id, l.qty]));
