const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const isSmoke = process.env.ENDER_ELECTRON_SMOKE === "1";
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
    if (!isSmoke) win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  if (isSmoke) {
    const timeout = setTimeout(() => {
      console.error("ENDER_ELECTRON_SMOKE_FAILED renderer timeout");
      app.exit(1);
    }, 15_000);
    win.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
      clearTimeout(timeout);
      console.error(`ENDER_ELECTRON_SMOKE_FAILED ${errorCode} ${errorDescription}`);
      app.exit(1);
    });
    win.webContents.once("did-finish-load", async () => {
      try {
        const result = await win.webContents.executeJavaScript(`({
          desktop: window.enderDesktop?.isDesktop === true,
          root: Boolean(document.getElementById("root")),
          title: document.title
        })`);
        if (!result.desktop || !result.root) throw new Error("preload or renderer root unavailable");
        clearTimeout(timeout);
        console.log(`ENDER_ELECTRON_SMOKE_OK ${JSON.stringify(result)}`);
        app.quit();
      } catch (error) {
        clearTimeout(timeout);
        console.error(`ENDER_ELECTRON_SMOKE_FAILED ${error.message || String(error)}`);
        app.exit(1);
      }
    });
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
