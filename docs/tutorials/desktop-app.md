# Run and Package the Desktop App

Ender's desktop app is built from the frontend in [`ui/`](../../ui/) and packaged with Electron.

## Development

```bash
npm install
npm run electron:dev
```

This launches:

- the Vite dev server
- the Electron shell pointed at that dev server

## Production build

Build the frontend only:

```bash
npm run build
```

Create an unpacked Electron build:

```bash
npm run electron:pack
```

Create installer artifacts:

```bash
npm run electron:dist
```

## Icon assets

Electron packaging reads its icon files from:

- `ui/public/icons/electron-icon.png`
- `ui/public/icons/electron-icon.icns`
- `ui/public/icons/electron-icon.ico`

The browser/UI icon files are separate.

## macOS notes

The macOS app icon is generated from the mac-specific master asset:

- `ui/public/icons/electron-icon-mac-master.png`

That file is padded so the Dock icon matches native apps more closely.

## Suggested release checks

Validate the installed Electron runtime and renderer/preload security boundary:

```bash
npm run smoke:electron
```

Create and smoke the current-platform unpacked application:

```bash
npm run electron:pack
npm run smoke:electron:packaged
```

Then run `npm run electron:dist` only on the intended release platform and inspect the installer, icon, application metadata, API connection, and first launch on a clean user account.

The current local evidence is an unsigned macOS arm64 unpacked application. Signing, notarization, DMG installation, Windows NSIS, and Linux AppImage checks are target-owner work until recorded otherwise in the [release readiness matrix](../../RELEASE_READINESS.md).

For runtime or packaging diagnosis, see [Troubleshoot Ender](../guides/troubleshooting.md).
