const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const runtimeIconPath = path.join(__dirname, "..", "public", "icons", "electron-icon-256.png");

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    icon: runtimeIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.setIcon(path.join(__dirname, "..", "public", "icons", "electron-icon-mac.png"));
  }

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
