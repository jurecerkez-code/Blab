// The only bridge between the page and the machine. Three of the five things
// it carries are about the microphone. macOS will not let an app grant itself
// access; only the person sitting there can; so the most an app can do is
// ask at the right moment and, if the answer was already no, open the exact
// settings pane instead of describing where it is.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blab', {
  /**
   * Which machine this is. Used once, at first launch, to pick the default
   * model: Apple Silicon runs the medium model comfortably, an Intel laptop
   * does not, and the page cannot tell them apart on its own.
   */
  device: {
    platform: process.platform,
    arch: process.arch,
    // Whether this machine can record what the computer is playing. Electron
    // captures system audio through a loopback device and supports that on
    // Windows only, so the meeting checkbox has nothing to offer anywhere
    // else. Better said before the recording than discovered after it.
    systemAudio: process.platform === 'win32',
  },
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

  /**
   * The git repository the named folder sits in, or null. The shell saw where
   * that folder is when access to it was granted; the page never can.
   */
  gitRoot: (folderName) => ipcRenderer.invoke('vault:git-root', folderName),
});
