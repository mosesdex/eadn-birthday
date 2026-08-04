# Design — EADN Birthday Pre-Order

**Date:** 2026-08-04
**Event:** Thursday 6 August 2026, EADN St. Paul's, 6 guests

## Problem

Six guests need to choose food ahead of a birthday dinner without the bill
running away. The host covers drinks. EADN serves sharing-style, so six
independent orders have to collapse into one order the restaurant can act on.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Cap style | £45 per guest, £270 table | Guests order independently; no live contention over a shared pot |
| Enforcement | Server-side in Postgres | A client-only cap is bypassable from devtools |
| Access | One tokenised link per guest | No signup, no password, no friction two days before the event |
| Drinks | Cocktail picker, 2 per guest, host pays | Host wanted visibility on the bar spend without charging guests |
| Backend | Existing `station-one` Supabase project | Free, already provisioned, no wait |
| Hosting | GitHub Pages, no build step | Edits go live on push |

## Architecture

Static HTML/CSS/ES-modules talking to Supabase over `fetch` against the REST
RPC endpoint. No framework, no bundler, and deliberately no CDN dependency —
one less thing to fail on the night.

```
index.html    landing for anyone without a link
order.html    guest picker      ?t=<guest-token>    → order.js
host.html     host dashboard    ?h=<host-token>     → host.js
api.js        rpc() wrapper, error mapping, money formatting
config.js     project URL + publishable key
```

## Data flow

1. `order.js` loads `bday_menu_and_rules()` and `bday_get_guest(token)` in parallel.
2. Guest taps steppers. Local state updates, the UI blocks anything over budget.
3. Changes debounce 700ms then call `bday_save_order(..., submit=false)`.
4. Submit calls the same RPC with `submit=true`, stamping `submitted_at`.
5. `host.js` polls `bday_host_summary(host_token)` every 15s.

## Trust boundary

The publishable key is public by design. It is inert because:

- every `bday_*` table is RLS-enabled with zero policies
- `EXECUTE` is revoked from `anon` on all functions except six RPCs
- `bday_price_lines` is revoked from `anon` entirely (internal helper)

`bday_save_order` never trusts a client-supplied price. It accepts only
`[{id, qty}]`, joins against `bday_menu`, and recomputes the total. It rejects:

| Attack | Result |
|---|---|
| Total over `food_cap` | `over_budget` |
| More than `cocktail_cap` cocktails | `too_many_cocktails` |
| Item id not in the menu | `unknown_food_item` |
| Cocktail id placed in the food array | `unknown_food_item` (kind mismatch) |
| Quantity < 1, > 10, or null | `bad_quantity` |
| Wrong or missing token | `invalid_token` |

All seven cases verified against the live deployment.

## Deliberately out of scope

Auth, payments, dietary flags, realtime subscriptions, guest-to-guest
visibility. Two days to the event; none of these change the outcome.

## Known limitation

Anyone holding a guest link can edit that guest's order. Acceptable: the links
go to six friends in a private chat, and the worst case is a changed dinner
order. Token enumeration is not possible — direct table reads return `42501`.
