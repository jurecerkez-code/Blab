// The only bridge between the page and the machine, and it carries three
// things, all about the microphone. macOS will not let an app grant itself
// access — only the person sitting there can — so the most an app can do is
// ask at the right moment and, if the answer was already no, open the exact
// settings pane instead of describing where it is.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blab', {
  /** 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unsupported' */
  micStatus: () => ipcRenderer.invoke('mic:status'),
  /** Shows the system prompt if it has never been answered. Resolves true if we may record. */
  requestMic: () => ipcRenderer.invoke('mic:request'),
  /** Opens System Settings on the microphone list. */
  openMicSettings: () => ipcRenderer.invoke('mic:settings'),
});
