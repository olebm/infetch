# Contributing to Infetch

Thanks for your interest in contributing. This document describes the contribution paths and how to get started.

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Three ways to contribute

### 1. Code contributions

```bash
# Fork on GitHub, then:
git clone https://github.com/olebm/infetch.git
cd infetch
nvm use
npm install
npm run db:init
npm run dev
```

Workflow:

1. Create a branch from `main`: `git checkout -b feature/short-description`
2. Make your changes. Keep commits focused — use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
3. Before opening a PR, run:
   ```bash
   npm run lint
   npx tsc --noEmit
   npm run test
   ```
   All three must pass.
4. Open a PR against `main` with a clear description and a link to a related issue if applicable.

**Code style:**

- TypeScript strict mode. No `any` without a comment explaining why.
- No `// @ts-ignore` or `// @ts-expect-error` without a comment.
- ESLint config is enforced via `npm run lint`. Run with `--fix` to auto-format.
- Prefer existing utilities in `src/lib/` and `src/components/` over new abstractions.
- UI strings remain German (`du`-form). English variant is being introduced via the i18n workstream — see [#i18n](../../issues) for status.

**What needs help:**

- Provider auto-detection in [src/lib/email-providers.ts](src/lib/email-providers.ts) — add new IMAP/SMTP server presets.
- Portal recipe robustness in [src/portals/agent/](src/portals/agent/) — selectors that survive vendor UI changes.
- DACH-region accounting integrations beyond Kontist/Accountable (Lexware, DATEV, etc).
- Tests for the portal-agent state machine.

### 2. Portal recipes

If you got a portal working that doesn't yet have a community recipe:

1. Open the **Recipe-Details** drawer for that vendor in the app (Einstellungen → Online-Konten → Code icon).
2. If your recipe has a success rate ≥ 80%, you'll see a **"Share on GitHub"** button. Click it.
3. The button opens a pre-filled PR against [invoice-agent-recipes](https://github.com/invoice-agent/invoice-agent-recipes). Recipes contain selectors only — never credentials or invoice data.
4. We merge after review and the recipe is available to all users via the daily community-sync job.

You can also share manually: copy the JSON from the Recipe drawer, drop it into `recipes/<vendor-key>.json` in the recipes repo, and open a PR.

### 3. Translations

The current UI is German-only. We are introducing an English variant via `next-intl` (see the i18n workstream).

To contribute translations:

1. Look for `messages/de.json` and `messages/en.json` (once the i18n workstream lands).
2. Add or correct strings in `messages/en.json`.
3. New languages are welcome — open an issue first so we can agree on the locale code.

Until the i18n workstream lands, please don't translate hardcoded strings — they will move to `messages/` and your work would be lost.

## Bug reports

Open an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:

- App version (from `package.json`)
- Node version
- OS
- Logs from `data/logs/` (redact credentials)
- Steps to reproduce

Sensitive security issues go to **tools@ole-beekmann.de**, not public issues — see [SECURITY.md](SECURITY.md).

## Feature requests

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Describe the problem first, the proposed solution second.

## Out of scope

- **Multi-user / team features** — Infetch is single-user by design.
- **Cloud hosting** — the local-first model is non-negotiable.
- **Closed-source integrations** — proprietary vendor SDKs that don't accept AGPL won't be merged.

## License

By contributing, you agree that your contributions will be licensed under [AGPL-3.0-or-later](LICENSE).
