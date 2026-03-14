const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("enderDesktop", {
  isDesktop: true
});
