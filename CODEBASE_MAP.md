# Conta code map

| Area | Entry point | Data flow |
| --- | --- | --- |
| Screens and forms | `index.html`, `styles.css` | `app.mjs` renders views and handles interactions |
| Workspace validation and totals | `core.mjs` | `validateState` migrates/normalizes schema v1–v5; balance, portfolio, debt and net-worth helpers feed the UI |
| Salary, bills, cash planning | `planning.mjs`, `payroll.mjs`, `loans.mjs`, `investments.mjs` | Plans become scheduled rows; posting records transactions/contributions and updates occurrence history |
| Local persistence | `app.mjs`, `start.py` | UI validates and caches, then reads/writes JSON through `/data`; launcher atomically saves backups |
| PDF statement import | `app.mjs`, `statement.mjs`, `start.py` | `/pdf-text` uses local `pdftotext`; parser proposes rows, duplicate/category helpers aid review, selected rows enter normal transaction validation |

Spending flow: quick shortcut or transaction form → account-linked transaction → `validateState` → account balance and net worth. Reconciliation compares a manually entered bank balance with the calculated one and records the difference as a categorized transaction.

Net worth = cash + meal-card balance + holdings − remaining principal on tracked loans. Investment contributions are tracked separately from spending. The safe-to-spend estimate excludes meal-card funds, unpaid commitments and the selected cash buffer.

Integration order: finance core/planning contracts → UI consumers → PDF parser and import UI → docs/map. Keep dates displayed as `dd/mm/yyyy` and months as `mm/yyyy`; stored dates remain ISO. Money is integer cents. PDF parsing is conservative: uncertain directions and duplicate candidates require review; scanned PDFs are unsupported.
