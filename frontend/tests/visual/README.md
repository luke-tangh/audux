# Visual regression tests

This folder contains Playwright screenshot tests for the most regression-prone
MD3 layout areas:

- TopBar responsive command layout
- PlayerBar responsive media dock layout
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

The app may render with an empty library if the backend is unavailable. These
tests target layout stability, not backend data.
