import { app, BrowserWindow, BrowserView, ipcMain, session } from "electron";
import { is } from "electron-util";
import createServer from "./server";
import store from "./store";
import { exec, failFn, successFn } from "./utils";

// eslint-disable-next-line global-require
if (require("electron-squirrel-startup")) {
  app.quit();
}

createServer();

const createMainWindow = async () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
    },
  });
  // eslint-disable-next-line no-undef
  await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  if (is.development) mainWindow.webContents.openDevTools();
  return mainWindow;
};

const createBrowserWindow = async (parentWindow) => {
  const browserWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    parent: parentWindow,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
    },
  });
  // eslint-disable-next-line no-undef
  await browserWindow.loadURL(BROWSER_WINDOW_WEBPACK_ENTRY);
  if (is.development) browserWindow.webContents.openDevTools();

  const view = new BrowserView({
    webPreferences: {
      // eslint-disable-next-line no-undef
      preload: BROWSER_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });
  browserWindow.setBrowserView(view);
  view.setBounds({ x: 0, y: 0, height: 0, width: 0 });
  const { webContents } = view;
  if (is.development) webContents.openDevTools();
  const filter = {
    urls: ["*://*/*"],
  };
  const { webRequest } = webContents.session;
  webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const m3u8Reg = /\.m3u8$/;
    const tsReg = /\.ts$/;
    let cancel = false;
    const myURL = new URL(details.url);
    if (m3u8Reg.test(myURL.pathname)) {
      console.log("from here: ", details.url);
      parentWindow.webContents.send("m3u8", {
        title: webContents.getTitle(),
        requestDetails: details,
      });
    } else if (tsReg.test(myURL.pathname)) {
      cancel = true;
    }
    callback({
      cancel,
      requestHeaders: details.requestHeaders,
    });
  });

  webContents.on("dom-ready", () => {
    webContents.on("new-window", async (event, url) => {
      event.preventDefault();
      await webContents.loadURL(url);
    });
  });

  ipcMain.on("openBrowserWindow", () => {
    browserWindow.show();
  });

  ipcMain.on("closeBrowserWindow", () => {
    console.log("closeBrowserWindow");
    browserWindow.hide();
  });

  return browserWindow;
};

const init = async () => {
  const mainWindow = await createMainWindow();
  await createBrowserWindow(mainWindow);
};

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await init();
  }
});

app.on("did-frame-finish-load", async () => {
  try {
    const reactTool = process.env.REACT_EXTENSION_PATH;
    await session.defaultSession.loadExtension(reactTool);

    const reduxTool = process.env.REDUX_EXTENSION_PATH;
    await session.defaultSession.loadExtension(reduxTool);
  } catch (e) {
    console.log(e);
  }
});

app.whenReady().then(async () => {
  await init();
});

ipcMain.on("exec", async (event, ...args) => {
  const [name, path, url, headers] = args;

  let resp;
  try {
    const result = await exec(name, path, url, headers);
    resp = successFn(result);
  } catch (e) {
    resp = failFn(-1, e.message);
  }
  event.reply("execReply", resp);
});

ipcMain.on("setLocalPath", async (event, ...args) => {
  const [key, value] = args;
  store.set(key, value);
  event.reply("setLocalPathReply");
});

ipcMain.handle("getLocalPath", (event, key) => store.get(key));

ipcMain.on("closeMainWindow", async () => {
  console.log("close");
  app.quit();
});
