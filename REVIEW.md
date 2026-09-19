# Conta — code review

Reviewed 19 September 2026 by Claude Opus 5 (Claude Code), at the owner's request.
Scope: every source file in the repository at first commit — `index.html`, `styles.css`,
`app.mjs`, `core.mjs`, `payroll.mjs`, `loans.mjs`, `planning.mjs`, `investments.mjs`,
`start.py`, `start.sh`, plus the two test files. Findings marked **fixed** were applied
in commit `19dc2f2` and the follow-up commits on `main`; the rest are open and listed with
a recommendation, not a patch.

## Threat model

Local-only app. Loopback HTTP server, no auth, no accounts, no outbound calls from the
app itself, all data in `localStorage` under the `conta-v1` key. The realistic attack
surface is therefore small and specific:

1. A malicious backup JSON the owner is persuaded to import.
2. A hostile page open in the same browser.
3. Anything already running on the machine — out of scope; it has the localStorage anyway.

Nothing here handles bank credentials, and there is no server-side state to attack. Impact
of a successful attack is disclosure of the owner's financial records, not funds movement.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | No Content-Security-Policy behind ~40 `innerHTML` sinks | Medium | Fixed |
| 2 | No `Host` header check; loopback bind does not stop DNS rebinding | Low | Fixed |
| 3 | Loan CSV export bypassed the formula-injection guard | Low | Fixed |
| 4 | `styles.css` fetches Google Fonts — app is not offline as documented | Low | Fixed |
| 5 | Calendar year hardcoded to 2026; planning broke on 2027-01-01 | Medium (correctness) | Fixed |
| 6 | Three withholding tables claimed in the UI, two implemented | None — verified correct | Closed |
| 7 | Large workspaces freeze the tab: no pagination, full re-render per keystroke | Low | Open |
| 8 | `compareLoan` runs three full amortisations on every keystroke | Trivial | Open |
| 9 | Owner's real salary and age shipped as code defaults | Low (privacy) | Fixed |

### 1. No Content-Security-Policy — fixed

`app.mjs` writes to `innerHTML` or `insertAdjacentHTML` in roughly forty places. Every one
of them was traced: all user-controlled text passes through `escape()` (`app.mjs:9`), which
correctly covers `& < > " '`, and it is applied in attribute position as well as text
position. No injection was reachable. `browser_test.py:40` even asserts that a stored
`<img src=x onerror=...>` description does not produce an element.

So this was not an exploitable bug. It was a structural risk: the entire defence was one
helper being remembered at forty call sites, forever, and a single omission would expose
every financial record in `localStorage`. The CSP at `index.html:5` is the backstop.

`style-src` deliberately keeps `'unsafe-inline'`. Inline `style=` attributes compute bar
heights, conic-gradient spending rings and SVG geometry throughout; a strict style policy
blanks the UI. `script-src 'self'` is the half that matters against injected markup, and it
is strict. The two Google Fonts hosts are allowed only because of finding 4 — remove the
`@import` and those two sources can be dropped from the policy.

### 2. No `Host` header check — fixed

The server bound `127.0.0.1` (correct) but answered any `Host`, so a page using DNS
rebinding could read the app's source. It could not read `localStorage` — that is bound to
the `localhost:4173` origin, which the attacker's page does not have — which is why this was
low rather than critical. `start.py:19-32` now returns 421 for anything outside
`{localhost:4173, 127.0.0.1:4173}`, on `/health` as well as on files.

Verified: allowlisted hosts 200; `evil.example.com`, a subdomain with the right port, and a
missing `Host` header all 421; `/start.py` still 404.

### 3. Loan CSV bypassed the formula guard — fixed

`core.mjs` and `app.mjs` each carried their own copy of the cell escaper, and the loan
schedule export at `app.mjs:443` had neither — it joined values raw. Harmless as written,
since that export emits only numbers and `YYYY-MM` strings, but it was one added text column
away from writing an executable cell into a spreadsheet. There is now a single exported
`csvCell` in `core.mjs:138` and all three exports call it.

### 4. Google Fonts — fixed

`styles.css:1` is `@import url('https://fonts.googleapis.com/...')` for DM Sans and Manrope.
The README says no network is needed; that is not true today. Every launch tells Google the
owner's IP and user-agent. No financial data leaks — the request carries only the font URL —
but it contradicts the app's own framing, and it means the app degrades without internet.

Self-hosted rather than dropped, so the typography survives and the claim becomes true.
Both families are now bundled as variable `latin`-subset woff2 files (62 KB together),
listed in `PUBLIC_FILES`, and served as `font/woff2` via an `extensions_map` entry. The CSP
lost both Google hosts: `style-src 'self' 'unsafe-inline'` and `font-src 'self'`. Licensing
and re-download instructions are in `FONTS.md`; both families are SIL OFL 1.1, whose full
text ships with them as the licence requires. Verified by request: both files return 200
with the right MIME and `wOF2` magic bytes, and `styles.css` no longer contains an
`@import`.

### 5. Calendar year hardcoded to 2026 — fixed

`validatePayroll` required `/^2026-/`, `validateForecast` required both endpoints inside
2026, and `defaultForecast` looped to a literal `'2026-12'`. Confirmed before the fix:
`validateForecast({start:'2026-11-01', end:'2027-02-28'})` threw *"Choose start/end dates
within 2026"*. From 1 January 2027 the Planning tab could only project a year that had
already ended.

Rates being frozen at their published 2026 values is a deliberate, documented choice and is
correct. The forecast *window* being frozen was not. Months and plans from 2026 onward are
now accepted; a plan still covers a single calendar year, since spanning two years is a
feature rather than a repair. When a month outside 2026 is selected, `#payroll-result` states
that 2026 tables, meal limits and IAS are being reused, so the number is never silently
wrong. A related bug went with it: the meal-day ceiling used a hardcoded 2026, so February
2028 clamped to 28 days instead of 29 — it now derives the year from the row.

### 6. Tables I, II and III — verified correct, closed

The UI prints "Table I / II / III" (`app.mjs:283`), and the README cites tables I–III of
Despacho 233-A/2026. The code has two rate tables: `PAYROLL_TABLE` serves both `single` and
`married-two`, and `SINGLE_EARNER_TABLE` serves `married-one`. Table II exists only as a
larger per-dependant abatement — 34.29 for single, 21.43 for married-two, 42.86 for
married-one (`payroll.mjs:43`).

Checked on 19 September 2026 against the despacho as published (2.ª série, N.º 3,
suplemento, 06-01-2026, pages 3–5). **The implementation is correct.** Tabela I ("não casado
sem dependentes ou casado dois titulares") and Tabela II ("não casado com um ou mais
dependentes") carry identical limits, marginal rates and parcelas a abater; they differ in
one column only, the parcela adicional a abater por dependente — 21,43 against 34,29. Tabela
III ("casado, único titular") uses 42,86. Every limit, rate and parcela in `PAYROLL_TABLE`
and `SINGLE_EARNER_TABLE` matches the published figures, and the first band's 0,00 per
dependant is handled by `index===0?0` in `payroll.mjs:43`.

Two neighbouring rules were confirmed in passing. Alínea h) of §5 reduces the marginal rate
by one percentage point for three or more dependants "mantendo-se inalterada a parcela a
abater e a parcela adicional a abater" — which is what `payroll.mjs:40-42` does, keeping the
variable abatement on the published base rate. Alínea g) caps the monthly IRS Jovem exemption
at the article 12.º-B limit divided by 14, matching `YOUTH_CAP/14`. The verification is
recorded in a comment at `payroll.mjs:2-4`.

### 7. Large workspaces freeze the tab — open

`validateState` caps lists at 50,000 entries each, and recurring rules at 1,000 × 2,600
posted months. Meanwhile `renderTransactions` rebuilds the entire table as one `innerHTML`
string, and it is wired to the `input` event of the search box (`app.mjs:147`), so every
keystroke re-renders every row. `pendingPayments` re-amortises every tracked loan on every
render, and `renderPlanning` calls `projectYear` twice.

There is no escalation path here — the only person who can load 50,000 transactions is the
owner — so this is a scale bug, not a vulnerability. But the validator's own limits are
reachable, and nothing between a few hundred rows and the cap is usable. Fix when it bites:
paginate or virtualise the transaction table and debounce the search input. Not worth
building before real data justifies it.

### 8. Three amortisations per keystroke — open

`$('#scenario-form')` fires `updateLoanSimulation` on `input`, and `compareLoan`
(`loans.mjs:96`) runs `amortize` three times, up to 600 months each. The third result,
`lower`, feeds exactly one sentence inside a collapsed `<details>`. Compute it on the
`toggle` event instead. Microseconds today on a mortgage; the consumer fixed-rate path has a
nested loop that makes it quadratic, so it is worth knowing about before someone widens the
term limits.

### 9. Personal defaults in shipped code — fixed

`defaultPayroll()` started at €1,300 gross and age 24, `sampleState()` overrode the sample
workspace to the same salary, and the README stated both in prose and worked a full
net-pay table from them. Harmless in a private repository and invisible to the app's own
users, but it is real personal data sitting in source control, and it would have travelled
with the first public push — the kind of thing an ignore rule cannot take back afterwards.

Defaults are now €1,000 and age 30, labelled in a comment as placeholders. Nothing is lost:
saved payroll settings live in `localStorage` and override the defaults, so an existing
workspace keeps its real figures. The README's worked example was recomputed from the new
placeholder rather than deleted, so it still demonstrates the 12-versus-14 arithmetic, and
four tests that had silently depended on the old default now pin `gross` and `age`
themselves — which is where those values belonged anyway.

## What is good

This is careful work, and the parts that are careful are the parts that matter.

**`validateState` (`core.mjs:38`) is a real allowlist validator**, not a shape check. It runs
on import, on every save, and on cross-tab load. It rebuilds its output field by field, so
unknown keys never survive a round trip and `JSON.parse` cannot smuggle anything through. It
enforces referential integrity in both directions — an account in use cannot be deleted, a
transaction cannot name a missing account, a payment occurrence cannot be duplicated
(`core.mjs:86`). This single function is why the malicious-backup threat is largely closed,
and it is the best thing in the codebase.

**Money is integer cents everywhere.** No floats, no accumulated drift. `cents()` rejects
`1e3`, `.5`, `0.005`, `+1` and trailing whitespace — all confirmed by running it, not by
reading it. Schedules conserve principal exactly, and the tests assert that.

**`start.py` does not trust its own framework.** `translate_path` is replaced with an
eight-file allowlist, so traversal and percent-encoded dot-dot both dead-end at
`__not_public__` rather than relying on `SimpleHTTPRequestHandler` doing the right thing.
`nosniff` and `no-store` are set. This is the opposite of the usual "serve the directory and
hope" launcher.

**`app.mjs:41` refuses to write when existing storage is unreadable.** It will not overwrite
recoverable data with an empty workspace, and the backup button switches to exporting the raw
stored string in that state (`app.mjs:132`). Cross-tab edits reload rather than letting a
stale tab clobber a fresh one. Someone thought about how people actually lose data.

**Tests earn their keep.** Thirty unit tests covering bracket boundaries, both withholding
tables, duodécimos, amortisation identities, migration round-trips for versions 1 through 4,
and cash reservation double-counting. The Playwright suite drives real flows and checks the
downloaded CSV and backup bytes. Every rate carries a source link and a verification date in
the code, not only in the README.

**No dependencies and no build step.** For an app that will be maintained occasionally over
years, this is worth more than it looks.

## For whoever picks this up next

1. Nothing blocks a public push. Findings 1–6 are resolved; 7 and 8 are scale and
   micro-performance items with no correctness or security impact.
2. Leave findings 7 and 8 until real usage justifies them. Both have a named fix above.
3. The rates carry a 2026 verification date. Re-check `payroll.mjs`, `core.mjs` and the
   fee constants in `loans.mjs` against their sources when the 2027 figures publish; the
   app reuses 2026 values for later years and says so on screen, but it cannot know better.
4. Fonts are bundled. If the typography is ever changed, update `FONTS.md`, `PUBLIC_FILES`
   and the CSP together.

Re-run the checks with:

```sh
node --test core.test.mjs
python3 -m py_compile start.py
./start.sh --no-browser   # then, separately: uv run --with playwright python browser_test.py
```
