import { app, shell, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import started from "electron-squirrel-startup";
import icon from "../../resources/icon.png?asset";
import { registerIpcHandlers } from "./ipc/handlers";
import { registerSyncHandlers, cancelAllSyncs } from "./ipc/sync-handlers";
import { closeDb } from "./db/singleton";

if (started) app.quit();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 675,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 22, y: 23 },
    icon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (is.dev) mainWindow.webContents.openDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        shell.openExternal(details.url);
      }
    } catch {
      /* invalid URL, ignore */
    }
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app
  .whenReady()
  .then(async () => {
    if (!app.isPackaged) {
      await import("dotenv/config");
    }

    electronApp.setAppUserModelId("com.commons.app");

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    const dragOffsets = new WeakMap<BrowserWindow, { x: number; y: number }>();

    ipcMain.on("window:start-drag", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      const [wx, wy] = win.getPosition();
      const cursor = screen.getCursorScreenPoint();
      dragOffsets.set(win, { x: cursor.x - wx, y: cursor.y - wy });
    });

    ipcMain.on("window:dragging", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      const offset = dragOffsets.get(win);
      if (!offset) return;
      const cursor = screen.getCursorScreenPoint();
      win.setPosition(cursor.x - offset.x, cursor.y - offset.y);
    });

    ipcMain.on("window:stop-drag", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) dragOffsets.delete(win);
    });

    registerIpcHandlers();
    registerSyncHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err) => {
    console.error("Fatal: app initialization failed:", err);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  cancelAllSyncs();
  closeDb();
});
