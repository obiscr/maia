# Templates: importable workflow templates

Each `.json` file in this directory is an **import-ready** workflow template for the UI import feature.

## Included templates

- `01-HelloWorld.json`: Minimal runnable workflow (1 step). Demonstrates params + `outputsSpec` mapping.

- `02-RSS-Scraper.json`: Fetch RSS/Atom/XML, parse/clean, de-duplicate, and limit final outputs.

- `03-HackerNews-Scraper.json`: Fetch HackerNews Top 10, parse and generate a TXT output (also registers an artifact).

- `04-Link-Availability-Checker.json`: Network link checker (HEAD + GET fallback), generates a Markdown report artifact, includes DAG branching + merge.

- `05-NPM-Dependency-Update-Checker.json`: Npm registry check for `package.json` deps using `semver`, generates a Markdown outdated report artifact.

- `06-GitHub-Repo-Checker.json`: GitHub repo checker (repo/release/issues/docs/package.json + doc link check), generates Markdown + JSON report artifacts, includes multi-branch DAG + merge.

## Resources

`resources` contains the resources required to run the template.