# Visual regression tests

This folder contains Playwright screenshot tests for the most regression-prone
MD3 layout areas:

- TopBar responsive command layout
- PlayerBar responsive media dock layout with deterministic playing, long-title,
  speed/volume/queue popovers, and dark-theme states
- theme bootstrap and reduced-motion behavior
- SelectField and playback-queue keyboard focus behavior

## Run

```bash
cd frontend
npm run test:visual
```

## Update snapshots intentionally

```bash
cd frontend
npm run test:visual:update
```

If this is the first run on a machine, install browsers first:

```bash
npx playwright install chromium
```

Linux snapshots use Ubuntu 24.04 with Noto CJK fonts. Install the matching font
before running or updating Linux snapshots:

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk
fc-cache -f
```

PlayerBar screenshots use mocked local API data so they cover the populated
media dock without reading a developer's local library. Other screenshots may
render with an empty library when the backend is unavailable; these tests target
layout stability, not backend data.

Regenerate platform-specific snapshots on their native OS. The older Windows
PlayerBar empty-state baselines were removed when the deterministic populated
fixture was introduced.

## Generate Windows and macOS baselines in GitHub Actions

The manually triggered `Update visual baselines` workflow generates and verifies
snapshots on the pinned `windows-2025` and `macos-15` GitHub-hosted runners.
GitHub only exposes a `workflow_dispatch` workflow after the workflow file is
present on the repository's default branch, so merge this workflow before its
first use.

1. Open the repository's **Actions** page.
2. Select **Update visual baselines**.
3. Choose **Run workflow** and select the branch containing the UI changes.
4. Download the `visual-baselines-windows` and `visual-baselines-macos`
   artifacts from the completed run.
5. Extract both artifacts into `frontend/tests/visual/__screenshots__/`, review
   the PNG changes, and commit them.

The artifacts are retained for seven days. They contain only the generated
`chromium-win32` or `chromium-darwin` snapshots for their runner. The workflow
does not push commits or modify the selected branch.
