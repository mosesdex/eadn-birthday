# Birthday Pre-Order — PIRAÑA London

Food pre-ordering for a birthday dinner at [PIRAÑA London](https://www.piranalondon.com/),
Thursday 6 August 2026. Six guests, Nikkei, Mayfair.

Guests never see a figure. They pick, and the app quietly refuses anything that
would go over. Budgets live in `bday_config` and are visible only on the host
side: £50 each across the whole menu (matching the venue's £50pp minimum spend,
confirmed by phone), two cocktails each on the host.

Piraña's mains start at £32, so a single purse per guest is the only split that
works here — there is no separate shared-plate allowance as there was at the
previous venue. `pot_cap` is 0 and the pot columns are retained but unused.

On top of every price the venue adds 10% service, a 5% entertainment charge and
a £3pp cover.

## Pages

| Page | URL | Who |
|---|---|---|
| Landing | `/` | Anyone without a link |
| Guest picker | `/order.html?t=<guest-token>` | One unique link per guest |
| Host dashboard | `/host.html?h=<host-token>` | Host only |

## How the budget cap works

Each guest has three separate allowances: their own plate, their share of the
table dishes, and their drinks. The UI greys out the `+` button on anything that
would breach one, but **that is only a convenience**. The real enforcement is
in `bday_save_order`, a Postgres function that:

- recomputes every price from the `bday_menu` table, ignoring whatever the client sent
- rejects the write if the recomputed total exceeds `food_cap`
- rejects unknown item ids, kind mismatches (a cocktail smuggled into the food array),
  and quantities outside 1–10
- caps cocktails at `cocktail_cap` units per guest

A guest who edits the page in devtools cannot overspend.

## Security model

Every `bday_*` table is RLS-enabled with **no policies**, and `EXECUTE` is revoked
from `anon` on everything except six RPCs. The publishable key in `config.js` is
therefore inert on its own: the only reachable surface is those functions, and each
one is gated on either a guest token or the host token.

Supabase's linter flags the RPCs as "anon can execute a SECURITY DEFINER function".
That is the intended design here, not an oversight — the functions *are* the API.

## Schema

```
bday_config   singleton: host_token, food_cap, pot_cap, table_cap, cocktail_cap, locked
bday_guests   id, token, name, seat
bday_menu     id, section, name, description, price, kind, note, pot_eligible
bday_orders   guest_id, food jsonb, pot jsonb, cocktails jsonb,
              food_total, pot_total, submitted_at
```

Orders store `[{id, qty}]` only. Prices are always resolved from `bday_menu` at
read and write time, so a menu price change reprices existing orders correctly.

## RPCs

| Function | Gate | Purpose |
|---|---|---|
| `bday_menu_and_rules()` | none | menu + caps + event details |
| `bday_get_guest(token)` | guest token | name and saved order |
| `bday_save_order(token, food, pot, cocktails, submit)` | guest token | validate and save |
| `bday_host_summary(host_token)` | host token | everything, plus merged kitchen list |
| `bday_host_rename_guest(host_token, id, name)` | host token | set a guest's name |
| `bday_host_set_lock(host_token, locked)` | host token | freeze all orders |

## Changing the numbers

```sql
update bday_config set food_cap = 40, pot_cap = 150, table_cap = 390, cocktail_cap = 3 where id = 1;
```

Menu edits go straight into `bday_menu`; the site picks them up on next load.

## Local development

```bash
python3 -m http.server 8899
```

Then open `http://localhost:8899/order.html?t=<token>`.
