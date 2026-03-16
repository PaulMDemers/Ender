# Run and Package the Desktop App

Ender's desktop app is built from the frontend in [`ui/`](../../ui/) and packaged with Electron.

## Development

```bash
cd ui
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

- Launch `electron:dev` once to verify runtime icons
- Run `electron:dist` for your release platform
- Open the built app and confirm the dock/taskbar icon, installer icon, and app metadata look correct

