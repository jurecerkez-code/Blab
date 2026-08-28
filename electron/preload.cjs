// The only bridge between the page and the machine. Three of the four things
// it carries are about the microphone. macOS will not let an app grant itself
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

  /**
   * The fourth. Says whether a recording is live, which is the only thing the
   * shell needs in order to keep the machine awake and to ask before a close
   * throws the take away.
   */
  setRecording: (active) => ipcRenderer.send('recording:state', active),
});
