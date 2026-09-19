# Preparing Conta for GitHub

Conta is a local, static browser app with a Python standard-library launcher. It currently needs no credentials, API tokens, environment variables, package install or build step. An `.env` file would serve no purpose today.

## What belongs in the repository

Commit the HTML, CSS, JavaScript modules, Python/shell launchers, tests and documentation. Sample records must remain fictional. Desktop shortcuts are machine-specific and stay outside the repository. The README uses a relative project path so clones work in other locations.

Keep real backups, statements, exports and screenshots of personal finances out of the repository. The ignore rules cover Conta's generated filenames, private-data folders, local environment files and common credential files; they cannot identify every renamed financial document. Store any local finance files under `private/`, `backups/` or `statements/` and review the exact staged file list before the first commit.

Your finances live in `conta-data.json` and `history/` beside the app, plus a localStorage cache (`conta-v1`). The ignore rules cover the files; check the staged list before the first commit, because unlike browser storage a file in the working tree can be staged by accident. Backups contain sensitive financial information and are not encrypted. Never include them in issues, tests or a public repository.

## Secrets and future integrations

There are no bank connections or quote-provider keys in this version. Prices and statement values are entered manually. Public product links contain no credentials.

If an integration later requires a secret API key, keep the credential in a server-side environment variable or managed secret store. Frontend JavaScript, build-time frontend environment variables and browser storage cannot keep a secret from users. Do not put bank login details or policy/account numbers into the app's code or configuration. Add an `.env.example` containing placeholder names only when an actual server-side integration exists. The Python server explicitly serves only the app's public files; `.env`, backups and source-only documents are not served.

For repository automation, grant only the permissions each workflow needs and use repository/environment secrets for credentials. Before a public push, enable GitHub's available secret scanning and push protection for the chosen repository. An exposed credential must be revoked or rotated; adding it to `.gitignore` later is not sufficient.

## Checks before the first push

- Choose the GitHub owner, repository name and public/private visibility.
- Choose a license if others should have permission to reuse or distribute the app. No license choice is assumed here.
- Review staged contents for names, personal paths, financial records and credentials. Ignore patterns do not remove previously committed data.
- Run `node core.test.mjs`, `python3 -m py_compile start.py`, and the optional isolated browser checks described in README. A future CI workflow should run these checks without access to real financial data.
- Review the tax/product assumptions and their dated sources before presenting them as current information.

No repository has been created or pushed by this preparation.

## Hosting is a separate choice

Putting source on GitHub does not require hosting the app. The existing launcher keeps serving it on loopback at `http://localhost:4173`.

A static host can serve the public HTML/CSS/modules, but a different origin has separate browser storage. Export a backup locally and import it in the new origin if migrating. Hosting alone does not add accounts, authentication, encryption, sync or bank integration. Keep personal data out of any deployed source directory and preserve browser backup/restore.
