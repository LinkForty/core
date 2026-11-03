# Export and Import

Move a server's links and analytics to another LinkForty server (self-hosted or LinkForty Cloud), or keep a backup, with a **bundle**: one gzipped file of newline-delimited JSON.

```bash
# Everything on this server
DATABASE_URL=postgres://... npx linkforty export backup.lfbundle

# One organization's data
DATABASE_URL=postgres://... npx linkforty export acme.lfbundle --organization <organization-id>

# Check a bundle against a database without writing anything
DATABASE_URL=postgres://... npx linkforty import acme.lfbundle --dry-run

# Import it; add --organization <id> to import into an existing organization
DATABASE_URL=postgres://... npx linkforty import acme.lfbundle
```

**What a bundle carries:** organizations (name and the `appConfig` and `launchpad` settings), link templates, links, click events, device fingerprints, install events, in-app events and webhooks.

**What it leaves out:**
- **Webhook signing secrets.** Import issues new ones and prints them, so update your receivers.
- **Link-safety state** (`warn_at`, `disabled_at`, `disabled_reason`, `suspended_at`), which belongs to the server that set it.

**How import works:**
- **Ids are kept**, so links, clicks and installs stay connected and apps keep their install ids.
- **Checked first.** It reports conflicts before writing anything: ids already present, short codes already used in the target organization, template slugs already taken.
- **All or nothing.** It writes everything in one transaction.
- **Tamper check.** A bundle that was cut short or edited is refused, because its checksum no longer matches.

**From code:** use `exportBundle`, `exportBundleToFile`, `importBundle` and `importBundleFile`, exported from the package root. `BUNDLE_TABLES` lists every column and whether a bundle carries it. A schema test fails when a column is added without a classification there.
