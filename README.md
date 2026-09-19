# Conta

A local personal finance tracker for mainland Portugal: cash accounts, investments, spending and 2026 IRS calculations. Python 3 is the only runtime requirement; no build, package install or bank credentials are needed. Fonts are bundled, so the app loads nothing from the internet.

## Launch locally

Double-click **Conta** on the desktop, or search for **Conta** in the Applications menu. It opens in your default browser without a terminal. The local server stays running in the background until you log out or restart; opening Conta again reuses it.

Alternatively, launch from a terminal:

```sh
cd conta
./start.sh
```

The launcher opens **http://localhost:4173** in your browser. Keep the terminal open; **Ctrl+C** stops it. Relaunch with the same command any time. It detects an existing Conta server and reuses it without starting a duplicate.

For a terminal without a graphical browser, use `./start.sh --no-browser`. You can also run `python3 start.py` directly, including on Windows. Always use the same browser profile and URL: `localhost` and `127.0.0.1` have separate browser storage.

The first launch displays labelled sample records. Choose **Start my finances** for an empty workspace. The salary fields start from placeholder values — €1,000 base, age 30, first eligible income year, €9.60 meal card per paid working day — which are not anyone's pay; replace them with yours. IRS Jovem requires confirmation of eligibility and whether your employer applies it. The default 22 meal days/month and 242/year are editable planning assumptions.

## What is included

- Overview: the month's balance, money in, money out and tracked assets, plus a ring showing every euro that left your accounts — loan instalments and monthly bills separated from discretionary categories, with investment contributions included even though they are not expenses.
- Transactions: income and expenses, dates, categories, bank-account assignment, search, filters, editing, deletion and CSV export.
- Accounts: current accounts, savings, brokerage cash and cash; an opening balance plus assigned activity determines each balance. Transfers move money between accounts without creating income or spending. Referenced accounts cannot be deleted until transactions are reassigned and transfers removed.
- Portfolio: ETFs, stocks, funds, bonds, crypto and other holdings; fractional units, remaining cost basis, manual EUR prices, unrealised gain/loss, allocation and holdings CSV export.
- Tracked assets: cash plus holdings, excluding loan balances. Brokerage account balances must contain cash only, so securities are not counted twice. Unassigned transactions do not affect account balances.
- History: save daily cash/portfolio valuations; view their timeline and delete snapshots. Deposits, withdrawals and changes in holdings affect these values, so the history is not a time-weighted investment return.
- Backups: JSON export/restore includes accounts, transfers, transactions, holdings, snapshots, both calculator settings, loans, monthly expense rules, salary plans, investment plans and contribution history. Version-1, version-2 and version-3 backups and existing saved transactions migrate without changing transaction amounts or dates.

Bank accounts and quotes are tracked manually. No bank login, live market feed, currency conversion or trading connection is used. Editing holdings does not post a cash movement or calculate realised gains. Record/reconcile cash changes separately.

## Monthly salary, meals and first-year benefits

The monthly calculator supports **resident mainland employees in the general 11% employee Social Security regime, without disability**, using tables I–III of Despacho 233-A/2026, checked against the published despacho on 19 September 2026. Choose not married, married/two earners, or married/one earner, and the number of dependants. The applicable marginal withholding rate is reduced by the table's parcela a abater and dependant allowance. The additional one-percentage-point reduction for three or more dependants is included. IRS is rounded down to whole euros under CIRS 99-E.

Monthly withholding bands are different from annual IRS bands. The implemented official tables apply from January 2026. A month in a later year may be selected for planning; the 2026 tables, meal limits and IAS are then reused and the result says so. This is a payslip estimate, not a final annual IRS settlement. Overtime, disability tables, partial employment years, multiple employers, other special regimes and additional remuneration are outside the model.

### IRS Jovem

Eligibility requires age up to 35, non-dependent status, a qualifying income year, regularised tax affairs, and no incompatible NHR, IFICI or returning-resident regime. The income-year counter excludes dependent years; it is not simply the number of returns filed.

Exemption percentages: year 1 = 100%; years 2–4 = 75%; years 5–7 = 50%; years 8–10 = 25%. The annual cap is **55 × €537.13 IAS = €29,542.15**. For withholding, exemption is capped at 1/14 of that amount per complete salary/allowance. The effective rate determined using full pay applies only to the non-exempt share; the remaining amount is not used to look up a lower bracket. Employee SS still applies.

The default shows ordinary withholding and a clearly labelled hypothetical first-year preview. To apply the benefit to the main estimate, enable IRS Jovem, confirm eligibility and indicate that the employer applies it. If the employer does not apply it, ordinary withholding remains in the main figure. The app does not claim the benefit with AT or your employer.

### Meal allowance

The 2026 daily exemption is €6.15 for cash and €10.46 for a meal card. Only the excess enters the IRS/SS base. Enter actual paid working days; allowance is not multiplied by 14 or paid on the extra salaries. Card value is shown separately from the bank deposit.

### 12 versus 14 payments

**Both schedules preserve 14 × monthly base salary annually**, so €1,000 means €14,000 in either case. With 14 payments, show the regular month and two separate net allowances. With 12 payments, apportion holiday and Christmas allowances in twelfths. Their withholding is calculated autonomously on each full allowance, then apportioned, in accordance with CIRS 99-C(5–6); they are not added to base salary to look up a higher band. SS applies to the month's contribution base. Cent rounding can cause small differences that payroll may reconcile.

Worked from the placeholder profile above, with 22 meal-card days and first-year IRS Jovem eligibility and employer application confirmed:

| Item | 14-payment ordinary month | 12 payments with duodécimos |
|---|---:|---:|
| Base salary | €1,000.00 | €1,000.00 |
| Gross duodécimos | — | €166.66 |
| IRS withholding | €0.00 | €0.00 |
| Employee SS | €110.00 | €128.33 |
| Bank deposit | €890.00 | €1,038.33 |
| Meal card | €211.20 | €211.20 |
| Combined net value | **€1,101.20** | **€1,249.53** |

Each separately paid allowance in the 14-payment schedule is €890.00 net, without meals. These figures assume a complete salary month, the general SS regime and the entered eligibility conditions.

The full-year projection assumes unchanged pay for a complete year. It distributes the entered annual meal days evenly over twelve months to estimate withholding, and is labelled as a planning estimate. It is not a final annual IRS liability or the user's actual first-year earnings.

## Integrated planning and available cash

**Overview** and **Planning** show recorded account cash, reserved payments and available cash. Reservations include unpaid recurring bills, tracked loan instalments and investment contributions through the selected month, including overdue items. Future recorded expenses are reserved until their date. Expected salary and meal-card balances are not spendable cash until income is recorded. Linked payments recorded without an account stay reserved until assigned; assign them to reconcile your cash balance.

The payment list shows the twelve oldest due items and counts the rest, so a skipped year does not bury the page. Use **Record paid** for an individual due bill/loan, or **Record due payments** for all due bills and loan instalments. Each occurrence records once, deducts its assigned account, and releases its reservation without double counting. Investment contributions need the actual units or statement value, so they are recorded separately. Recording is manual; opening the app never silently posts payments. Remove any equivalent manually entered transaction before recording its scheduled occurrence. Deleting a posted expense keeps its posting history, so it is not automatically reposted.

The salary plan has inclusive start/end dates inside one calendar year, 2026 or later, and a payday. Change gross salary, meal days and allowances month by month. The forecast counts paydays within the date range; it does not prorate entered monthly amounts. Allowances are assumed to arrive on the same payday. Monthly bank remainder subtracts recurring bills, loans, investment contributions and other recorded spending from expected salary; it is separate from available account cash. For 14 payments, holiday and Christmas amounts are entered separately (the initial plan assumes Christmas in December). For 12 payments, duodécimos are automatic.

Recurring bills have start/end dates, a payment day, an optional account and pause/resume. Days 29–31 fall on the last day of shorter months. Resuming includes missed dates unless you change the start date. Changes affect unposted occurrences; posted transactions remain unchanged. Required and optional fields are labelled.

## Recurring investments and PPR tracking

In **Portfolio**, add a holding, then a **Contribution plan**: source account, monthly amount, payment day, start/end dates, investment value at the start and assumed annual effective growth rate. One plan per holding keeps the comparison unambiguous. Planned contributions reserve cash and appear in Planning. **Record contribution** records the amount paid, actual units received and valuation; it increases cost basis and deducts cash without classifying an investment purchase as everyday spending. Do not also enter it as an expense.

Holdings support **units × unit price** or **total statement value**. The latter supports insurance PPRs, deposits and managed portfolios without inventing a ticker or unit count. **Add Santander PPR** prefills the product name, provider and category for Seguro PPR+ Ações; you enter your own cost basis and statement value. It creates no bank connection and requires no bank credentials or policy number. For this insurance product, use your statement's total value or its units and unit value when available. See the [official Seguro PPR+ Ações page](https://www.santander.pt/poupanca-reforma/seguro-ppr-acoes). For ordinary Santander investment funds, the [Fund Centre](https://www.santanderassetmanagement.pt/tools) publishes fund identifiers and unit values. These are different product sources.

The projection applies the annual effective rate between dated contributions using a 365.25-day year. Enter a rate after ongoing fees, before tax; negative rates are supported. Projection results separate initial value, contributions and growth. The actual comparison uses the holding's manually entered valuation date, and shows actual versus planned contributions so a shortfall is not mistaken for poor investment performance. Returns are not guaranteed. Withdrawals, tax relief, redemption fees and taxes are outside the projection. Editing a plan recalculates its projection rather than preserving an old target.

**Undo** reverses a recorded contribution's cash, cost and units and reopens its scheduled occurrence. The latest quote or statement value is kept; reconcile that value separately. Existing holdings can be entered as opening positions, without affecting cash. Account and holding deletion is blocked while contribution records reference them. Use **Save today** for the existing portfolio valuation history.

## Loans and earlier payoff

**Loans** saves home, car and personal loans using their outstanding principal, start/end dates of the remaining payment period, payment day and optional payment account, TAN, quoted TAEG and current fixed/variable phase. A variable phase can be entered the way the contract quotes it — index (Euribor) plus spread — and the TAN is then their sum rather than a separate field; leave either part blank to type a TAN directly. Switching to a fixed phase clears both, since a fixed rate has neither. Enter rates from your agreement; the app does not invent market offers. Disable **Include scheduled instalments** for hypothetical loans. The payment count is calculated from the inclusive dates and chosen payment day. The saved principal is the amount outstanding before the first payment in that range. Recorded instalments affect cash and posting history; they do not change this schedule basis. To reconcile a new lender balance, also move the remaining start date forward. Simulations never post transactions. Scenario controls are temporary and reset on reload; export the schedule to keep a comparison.

The main simulation keeps the normal instalment and shortens the term. Choose **One-off (Pontual)**, **Recurring (Recorrente)**, or both. Recurring extras can repeat every 1, 2, 3, 6 or 12 months. With a start of zero, the one-off precedes the first instalment and recurring extras begin with that instalment. With N scheduled payments, the one-off follows payment N and recurring extras start with N+1. Extra amounts reduce principal; fees are paid on top. The final recurring payment is capped at the remaining balance. One-off amounts above the available principal are rejected.

Results show payoff month, months saved, interest saved, repayment fees including stamp duty, and net savings after fees, plus a balance chart and an exportable monthly schedule. A secondary comparison shows recalculating the instalment after each extra payment. Simulations assume constant TAN and monthly amortisation; variable-rate changes, balloons, grace periods, leasing and revolving credit are outside the model. Mortgage term reduction requires lender agreement; ordinary partial repayment normally reduces the instalment.

- TAN drives interest and the repayment schedule. TAEG is the lender’s total-cost annual rate, displayed for reference, not added to TAN.
- Index and spread are recorded for reference and to derive the TAN. Rates are not fetched; when Euribor resets, update the index yourself and the schedule follows. The simulation still assumes the TAN holds for the whole term.
- Loan-only monthly costs represent entered insurance/account costs that end at payoff. Do not enter them again as recurring expenses. The totals cover remaining entered costs, not a legally certified TAEG or original-contract MTIC.
- 2026 mortgage repayment-fee maxima: 0.5% for variable rates; 2% for fixed rates. The temporary variable-rate suspension ended on 31 December 2025.
- Consumer contracts from 1 July 2009: fixed-rate maximum 0.5% when more than a year remains, 0.25% otherwise; variable-rate fee zero. Consumer fees cannot exceed interest remaining until the end of the fixed-rate period; the constant-rate model assumes that period extends to maturity.
- Blank repayment fee uses the statutory maximum. Enter a lower contracted fee or zero for a waiver/exemption; the simulation caps entered fees at the applicable maximum. Fee stamp duty defaults to 4%, editable for exemptions. Consumer interest duty defaults to 4%; own-home acquisition interest defaults to 0 under CIS 7(1)(l), also editable.

Sources, verified 18 September 2026: [Banco de Portugal: mortgage repayments](https://clientebancario.bportugal.pt/pt-pt/como-reembolsar-e-transferir), [consumer repayment fees](https://clientebancario.bportugal.pt/pt-pt/node/3549), [TAN, TAEG and consumer taxes](https://clientebancario.bportugal.pt/pt-pt/taxas-de-juro-no-credito-aos-consumidores), [CIS 7 exemptions](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/selo/Pages/selo7.aspx), [stamp-duty general table](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/selo/Pages/ccod-selo-tabgiselo.aspx).

## Annual IRS calculator

The annual section accepts **rendimento coletável**, after applicable deductions, abatements and any applicable minimum-existence adjustment. It supports individual/joint taxation and solidarity tax. It does not apply annual IRS Jovem progression, calculate minimum-existence relief, tax credits or a refund. Do not paste gross salary into the taxable-income field.

**Start from your salary plan** fills the field from the monthly settings instead: annual base salary plus any taxable meal excess, less the specific deduction of 8.54 × IAS or your Social Security contributions where those are higher (CIRS 25), less the IRS Jovem exemption for your income year within the annual cap. The breakdown is shown under the field. Treat it as a starting point for a single employment income and nothing else: other income, further deductions and the mínimo de existência are yours to add, and exempt IRS Jovem income still counts when the rate is determined, which this figure does not model.

It uses the published column-B average rate for the preceding completed band plus the marginal column-A rate on the excess, per CIRS 68(2). A band-by-band display shows how progressive rates apply, with any rounding difference from the statutory published-average method disclosed. Joint taxation divides income by two and multiplies the resulting tax by two. Solidarity adds 2.5% on the quotient between €80,000 and €250,000 and 5% above €250,000.

## Sources and versioning

Verified 18 September 2026. These rules apply to **2026 income**, not 2025 returns filed in 2026. Rates are versioned in `core.mjs` and `payroll.mjs` and do not update automatically.

- [2026 mainland withholding tables I–III: Despacho 233-A/2026](https://diariodarepublica.pt/dr/detalhe/despacho/233-a-2026-998488151)
- [Annual IRS: CIRS 68](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68.aspx)
- [Solidarity: CIRS 68-A](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68a.aspx)
- [Joint taxation: CIRS 69](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs69.aspx)
- [IRS Jovem: CIRS 12-B](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs12b.aspx)
- [IRS Jovem withholding: CIRS 99-F](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs99f.aspx)
- [Allowances and duodécimos: CIRS 99-C](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs99c.aspx)
- [Withholding rounding: CIRS 99-E](https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs99e.aspx)
- [IAS: Portaria 480-A/2025/1](https://files.diariodarepublica.pt/1s/2025/12/25001/0000200002.pdf)
- [2026 meal allowance: Portaria 51-B/2026/1](https://files.diariodarepublica.pt/1s/2026/01/02103/0001100011.pdf)
- [Meal-card exemption: AT employment-income FAQ](https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/questoes_frequentes/Pages/faqs-00062.aspx)
- [Employee Social Security](https://www.gov.pt/servicos/obter-informacoes-sobre-as-contribuicoes-para-a-seguranca-social-pagamento-de-entidade-empregadora-por-trabalhador-por-conta-de-outrem)

## Data and checks

Financial records remain in browser localStorage under `conta-v1` (schema version 4). Cash amounts use integer cents. No account or cloud sync is required. Clearing browser data deletes records: keep JSON backups from **Your data**. Fonts may load from Google Fonts, with system-font fallback offline; no financial records are sent there. The local launcher binds only to loopback and serves the app's public files.

Run financial logic and migration checks:

```sh
node core.test.mjs
```

Optional browser checks, with the app running:

```sh
uv run --with playwright python -m playwright install chromium
uv run --with playwright python browser_test.py
```

Checks cover annual and monthly bracket boundaries, SS, IRS Jovem caps/eligibility, meal-card/cash treatment, 12/14 schedules, transfers, portfolio valuation, migration, backup validation, annuity/principal conservation, one-off and recurring overpayments, fee caps/waivers, duplicate-proof expense posting, year-end forecasts and exports. Browser checks use isolated test storage and cover desktop/mobile layout and the complete user flows.

## GitHub preparation

See [GITHUB.md](GITHUB.md) for repository contents, private-data handling, secret/environment requirements and hosting considerations. No environment variables or credentials are required for this local version.
