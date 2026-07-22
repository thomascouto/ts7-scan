# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release notes for tagged versions are also generated automatically on the
[GitHub Releases](https://github.com/thomascouto/ts7-scan/releases) page.

## [Unreleased]

## [1.0.2] - 2026-07-22

### Added

- Tag-triggered release workflow: pushing a `v*` tag runs lint + test, publishes
  to npm (with provenance), and creates a GitHub Release with grouped notes.
- CI workflow running lint + test on every push to `main` and every pull request.
- Dependabot config for weekly npm and GitHub Actions updates.
- Release-notes grouping config (`.github/release.yml`) and standard labels.

### Changed

- Bumped CI/release actions: `actions/checkout@v7`, `actions/setup-node@v7`,
  `pnpm/action-setup@v6`.

## [1.0.1] - 2026-07-21

### Changed

- Added `repository`, `homepage`, and `bugs` metadata to `package.json`.
- Guarded publishing with lint + test via `prepublishOnly`.

## [1.0.0] - 2026-07-21

### Added

- Initial release of `ts7-scan`: a 100% static scan that classifies installed
  dependencies by their risk of breaking under TypeScript 7 (native `tsc`).

[Unreleased]: https://github.com/thomascouto/ts7-scan/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/thomascouto/ts7-scan/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/thomascouto/ts7-scan/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/thomascouto/ts7-scan/releases/tag/v1.0.0
