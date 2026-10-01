# Updating a self-hosted MoltenRock Trade

## How you know there is a new version

Once a day the portal fetches `https://moltenrocktrade.com/version.json` (a plain request: no shop data is sent) and remembers the answer. When a newer version exists, the owner sees it on the **Dashboard** and under **Status → Software**, with a *Check now* button. Switch the check off with the `update_check` setting (ask your agent).

## Update without a terminal (recommended)

The "Deploy to Cloudflare" button made **your own copy** of the app on GitHub, connected to Cloudflare: whatever lands in that copy is deployed. Updating means bringing the new version into your copy.

**Once:**
1. In your copy on GitHub: *Add file → Create new file*, name it `.github/workflows/update-moltenrock-trade.yml`, and paste the content of [`docs/github-update-workflow.yml`](github-update-workflow.yml). Commit.
2. *Settings → Actions → General → Workflow permissions*: tick **Allow GitHub Actions to create and approve pull requests**.

**Each update:**
1. *Actions → Update MoltenRock Trade → Run workflow* (it also runs by itself every Monday).
2. It opens a pull request "Update MoltenRock Trade to x.y.z". Read the changelog, then **Merge**.
3. Cloudflare deploys it (Workers & Pages → `moltenrock-trade` → Deployments). The database updates itself on the first request; there is nothing to run.

Your `wrangler.toml` (with your database id) is never changed by the update. Files you changed yourself are overwritten by the new version, so keep your own changes in settings, not in code.

## With a terminal

```bash
git remote add upstream https://github.com/Goldcote/moltenrock-trade.git   # once
git fetch upstream && git checkout upstream/main -- . ':(exclude)wrangler.toml'
git commit -am "Update MoltenRock Trade" && git push
```

## If something goes wrong

- **Code:** Cloudflare → Workers & Pages → `moltenrock-trade` → *Deployments* → roll back to the previous one. Database changes are only ever additive (new tables or columns), so an older version still runs on the newer database.
- **Data:** D1 *Time Travel* restores the database to any minute in the last 7 days (free plan) or 30 days (Workers Paid): Workers & Pages → D1 → `moltenrock-trade` → Time Travel.
- **Backups you keep:** Exports → *Complete backup* (JSON), and the accounting CSVs for your bookkeeping.

## For maintainers (publishing a version)

1. Bump `src/version.ts`, `package.json` and add the notes to `CHANGELOG.md`.
2. Merge to `main`.
3. Update `site/version.json` on moltenrocktrade.com: portals see it within a day.
