<div align="center">

# Conta

### A private, local-first finance tracker for life in Portugal

**Cash flow · salary · IRS Jovem · loans · investments · PPRs**

</div>

> [!NOTE]
> Conta is a fun side, vibe-coded project that grew from a simple need: one calm place to understand where my money is, what is due next, and what remains after it is paid.

Conta brings cash accounts, transactions, salary planning, Portuguese tax estimates, loans and investments into one browser-based workspace. It runs on your computer, stores your records beside the app, and requires no bank credentials, build step or package installation.

> [!IMPORTANT]
> This is an independent planning tool, not financial, tax or investment advice. Check important figures against your payslip, lender, broker and official Portuguese sources.

## Highlights

| | |
|---|---|
| **See the month ahead** | Combine scheduled salary, bills and loan instalments before they are paid. |
| **Understand Portuguese pay** | Estimate mainland withholding, Social Security, meal allowance, duodécimos and IRS Jovem. |
| **Track the full picture** | Keep cash accounts, investments, PPRs, loans and net worth together. |
| **Keep control of the data** | Save locally, export JSON backups and retain thirty previous workspace versions. |
| **Refresh market holdings** | Opt in to delayed EUR quotes for exchange-traded stocks and ETFs. |
| **Study each stock** | Look up any ticker without owning or watching it. Price history, fundamentals, dated theses, position risk and trade previews, matched benchmark returns, historical patterns, volatility sensitivity and a colour-rated metric guide with stated thresholds, for holdings and a watchlist. |

## Quick start

Double-click **Conta** on the desktop, or search for **Conta** in the Applications menu. It opens in your default browser without a terminal. The local server stays running in the background until you log out or restart; opening Conta again reuses it.

Alternatively, launch from a terminal:

```sh
cd conta
./start.sh
```

Your workspace is saved to `conta-data.json` next to the app, written atomically, with the previous thirty versions kept in `history/`. Copy, sync or back up that one file and you have everything. The browser keeps a cached copy too, so a save made while the server is unreachable is not lost; it is pushed the next time the app opens.

The launcher opens **http://localhost:4173** in your browser. Keep the terminal open; **Ctrl+C** stops it. Relaunch with the same command any time. It detects an existing Conta server and reuses it without starting a duplicate.

For a terminal without a graphical browser, use `./start.sh --no-browser`. You can also run `python3 start.py` directly, including on Windows. `./start.py --port` and `--data` serve a different port or workspace file, which is how the browser tests run without touching your finances.

The first launch displays labelled sample records. Choose **Start my finances** for an empty workspace. The salary fields start from placeholder values — €1,000 base, age 30, first eligible income year, €9.60 meal card per paid working day — which are not anyone's pay; replace them with yours. IRS Jovem requires confirmation of eligibility and whether your employer applies it. The default 22 meal days/month and 242/year are editable planning assumptions.

## What is included

- Overview: the month's balance, money in, money out and financial net worth; **This month, expected** — the salary your plan plays out, the bills, instalments and contributions already committed to the month, and what is left of the deposit once they are paid; plus a ring showing every euro that left your accounts — loan instalments and monthly bills separated from discretionary categories, with investment contributions included even though they are not expenses.
- Transactions: quickly log an expense with amount, category and paying account; description is optional and defaults to the category. Fuel, groceries, office and tech have their own categories. Income, dates, search, filters, editing, deletion and CSV export remain available.
- Accounts: current accounts, savings, brokerage cash and cash; an opening balance plus assigned activity determines each balance. Set the current balance from your bank to record any missing difference as untracked spending or other income. Record known expenses first. Transfers move money between accounts without creating income or spending. Referenced accounts cannot be deleted until transactions are reassigned and transfers removed.
- Portfolio: ETFs, stocks, funds, bonds, crypto and other holdings; fractional units, remaining cost basis, optional delayed EUR market-price refresh, unrealised gain/loss, allocation and holdings CSV export.
- Financial net worth: cash plus holdings less principal remaining on tracked loans. Loan balances are manual; update them from lender statements to keep this figure useful. Hypothetical loans, property and possessions are excluded. Brokerage account balances must contain cash only, so securities are not counted twice. Unassigned transactions do not affect account balances.
- Bank PDF import: extract selectable PDF text locally with Poppler's `pdftotext`, review rows and duplicates, then import chosen entries. Scanned/image-only statements need OCR and are not supported. Uncertain direction or ambiguous rows require manual review; merchant category rules are optional and local.
- Expense shortcuts and merchant rules speed up frequent entries. Weekly account reconciliation records an adjustment and date; safe-to-spend subtracts unpaid commitments and your cash buffer. Net worth history includes tracked debt and marks older valuations as stale.
- History: save daily cash/portfolio valuations; view their timeline and delete snapshots. Deposits, withdrawals and changes in holdings affect these values, so the history is not a time-weighted investment return.
- Backups: JSON export/restore includes accounts, transfers, transactions, holdings, snapshots, both calculator settings, loans, monthly expense rules, salary plans, investment plans, contribution history, shortcuts, merchant rules, the watchlist, per-ticker theses and dated notes, benchmark ticker and the cash buffer. Version-1 through version-4 backups migrate without changing transaction amounts or dates.

Dates are shown as dd/mm/yyyy throughout. CSV exports keep ISO `yyyy-mm-dd`, which spreadsheets parse the same way in every locale. Loan terms are shown in years and months alongside the payment count.

Bank accounts and statement-valued products are tracked manually. Exchange-traded holdings can opt into delayed quotes by using a market ticker such as `GALP.LS`, `SAN.MC` or `VWCE.DE`; automatic conversion from non-EUR listings is intentionally excluded. Quote refresh sends only those tickers to Yahoo Finance through the local server. No bank login or trading connection is used. Editing holdings does not post a cash movement or calculate realised gains. Record/reconcile cash changes separately. Adding a holding whose ticker you already hold records it as a purchase of the existing holding instead of a second position.

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

**Overview** and **Planning** show recorded account cash, reserved payments and available cash. Reservations include unpaid recurring bills, tracked loan instalments and investment contributions through the selected month, including overdue items. Future recorded expenses are reserved until their date. Expected salary is excluded until recorded; meal-card balances are tracked separately and never offered for bills. Linked payments recorded without an account stay reserved until assigned; assign them to reconcile your cash balance.

The payment list shows the twelve oldest due items and counts the rest, so a skipped year does not bury the page. Use **Record paid** for an individual due bill/loan, or **Record due payments** for all due bills and loan instalments. Each occurrence records once, deducts its assigned account, and releases its reservation without double counting. Investment contributions need the actual units or statement value, so they are recorded separately. Recording is manual; opening the app never silently posts payments. Remove any equivalent manually entered transaction before recording its scheduled occurrence. Deleting a posted expense keeps its posting history, so it is not automatically reposted.

The salary plan has inclusive start/end dates inside one calendar year, 2026 or later, and a payday. Change gross salary, meal days and allowances month by month. The forecast counts paydays within the date range; it does not prorate entered monthly amounts. Allowances are assumed to arrive on the same payday. Choose salary and meal-card destination accounts in the salary settings, then record each due salary once from Planning. Monthly bank remainder subtracts recurring bills, loans, investment contributions and other recorded spending from expected salary; it is separate from available account cash. For 14 payments, holiday and Christmas amounts are entered separately (the initial plan assumes Christmas in December). For 12 payments, duodécimos are automatic.

Recurring bills have start/end dates, a payment day, an optional account and pause/resume. Days 29–31 fall on the last day of shorter months. Resuming includes missed dates unless you change the start date. Changes affect unposted occurrences; posted transactions remain unchanged. Required and optional fields are labelled.

## Recurring investments and PPR tracking

In **Portfolio**, add a holding, then a **Contribution plan**: source account, monthly amount, payment day, start/end dates, investment value at the start and assumed annual effective growth rate. One plan per holding keeps the comparison unambiguous. A plan with a **0 € monthly contribution** projects growth only, for interest-paying broker cash, deposits or Certificados de Aforro, and schedules nothing. Planned contributions reserve cash and appear in Planning. **Record contribution** records the amount paid, actual units received and valuation; it increases cost basis and deducts cash without classifying an investment purchase as everyday spending. Do not also enter it as an expense.

Holdings support **units × unit price** or **total statement value**. Unit-based EUR listings can refresh automatically when Conta opens; quotes may be delayed or temporarily unavailable. Total statement value supports insurance PPRs, deposits and managed portfolios without inventing a ticker or unit count. **Add PPR** selects the appropriate category and statement-value method while leaving the product and provider open to any bank, insurer or broker. Enter your own remaining cost basis and the latest statement value; no bank credentials, policy number or account number are required.

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

## Disclaimer

Conta is a personal planning tool provided **as is**, without warranty of any kind. The author is not a financial adviser, financial or credit intermediary, accountant or lawyer, and is not authorised or supervised by the CMVM, Banco de Portugal or any other authority.

- **Not investment advice.** Stock ratings, patterns, scenarios and the metric guide are mechanical rules applied to past prices. They are not a recommendation to buy, sell or hold anything, and past performance does not predict future results.
- **Not tax or legal advice.** IRS brackets, IAS, IRS Jovem, meal allowance and Social Security figures are simplified rules for the year stated and may be outdated or inapplicable to you. The assessment issued by the Autoridade Tributária prevails. Confirm with a *contabilista certificado* before acting.
- **Loan figures are simulations.** The lender's contract and TAEG prevail.
- **Market data is third-party.** Quotes and company data come from Yahoo Finance, may be delayed, incomplete or wrong, and can stop working at any time. Conta is not affiliated with Yahoo, any bank, broker or authority.
- **Your data, your responsibility.** Everything stays on your device. Keep your own backups. The author accepts no liability for lost data or for decisions made using this software.

The same notice is shown in the app under **Your data → Legal notice**.

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

Financial records live in `conta-data.json` (schema version 5), written atomically with the previous thirty versions in `history/`; browser localStorage under `conta-v1` is a recovery cache. Cash amounts use integer cents. No account or cloud sync is required. Keep copies of the data file or JSON backups from **Your data**. Fonts are bundled. The only optional outbound requests go to Yahoo Finance: ticker-only quote lookups for holdings where automatic prices are enabled, and two-year price history and company data for holding ticker autofill and, while the Stocks page is open, each tracked ticker and the selected benchmark (this one uses a Yahoo session cookie the server fetches; nothing about you is sent). The local launcher binds only to loopback and serves an explicit allowlist of public files. PDF text extraction requires Poppler's `pdftotext`; the PDF stays on this computer.

Run financial logic and migration checks:

```sh
node --test core.test.mjs && node statement.test.mjs && node stocks.test.mjs && python3 statement_server_test.py
```

Optional browser checks start their own server and use a temporary workspace:

```sh
uv run --with playwright python -m playwright install chromium
uv run --with playwright python browser_test.py
```

GitHub Actions runs all of the above on every push (`.github/workflows/checks.yml`) and publishes the app as a static preview on GitHub Pages (`.github/workflows/pages.yml`, after enabling Pages with source "GitHub Actions" once). The preview has no app server, so changes stay in that browser and quotes or PDF import are unavailable there.

Checks cover annual and monthly bracket boundaries, SS, IRS Jovem caps/eligibility, meal-card/cash treatment, 12/14 schedules, transfers, portfolio valuation, migration, backup validation, annuity/principal conservation, one-off and recurring overpayments, fee caps/waivers, duplicate-proof expense and salary posting, year-end forecasts and exports. Browser checks use an isolated workspace and cover desktop/mobile layout and the complete user flows.
