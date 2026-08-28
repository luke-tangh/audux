# Audux documentation

[Repository home](../../README.md) · English · [简体中文](../zh-CN/README.md)

This documentation describes Audux `1.0.0`, database schema v6, and portable archive format v1.
The [v1 compatibility contract](reference/compatibility.md) defines the public stability boundary.

## Start here

- **First-time users:** [Install and get started](user-guide/getting-started.md)
- **ASR or AI setup:** [AI, ASR, and MCP configuration](user-guide/configuration.md)
- **Data and privacy:** [Data, backup, and security](user-guide/data-and-security.md)
- **Startup or task failures:** [Troubleshooting](user-guide/troubleshooting.md)
- **Contributors:** [Development and contribution](contributing/README.md)
- **Release maintainers:** [Reference and stability contracts](reference/README.md) and the
  [release validation checklist](contributing/release-checklist.md)

## Documentation sections

| Section | Audience | Contents |
| --- | --- | --- |
| [User guide](user-guide/README.md) | Users and integrators | Installation, providers, MCP, data safety, and troubleshooting |
| [Reference and stability](reference/README.md) | Users, integrators, and maintainers | v1 contracts, supported behavior, and security advisories |
| [Development and contribution](contributing/README.md) | Developers and release maintainers | Setup, tests, builds, packaging, and release validation |
| [Project planning](project/README.md) | Contributors and product maintainers | Roadmap, completed stages, priorities, and candidate work |
| [Release notes](releases/README.md) | All readers | Stable releases and historical internal candidates |
| [Historical material](history/README.md) | Maintainers tracing early decisions | Frozen documents that are not current contracts |

## Operating model

Audux keeps core playback, manual editing, keyword search, and export available without ASR, an
LLM, embeddings, or network access. Optional providers extend the application but do not become
security boundaries: the backend validates media paths, injects agent scopes and permissions, and
owns every persistent transaction.

The original media stays in user-selected library roots. Audux stores its database, generated
content, backups, optional components, and model cache under `~/.audux/` by default.
