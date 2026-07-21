// Bits of the File System Access API that TypeScript's lib.dom does not ship yet.
type PermissionDescriptorFS = { mode?: 'read' | 'readwrite' };

interface FileSystemHandle {
  queryPermission?(descriptor?: PermissionDescriptorFS): Promise<PermissionState>;
  requestPermission?(descriptor?: PermissionDescriptorFS): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

type MicStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unsupported';

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string | FileSystemHandle;
  }): Promise<FileSystemDirectoryHandle>;

  /** Present only in the desktop app. The browser build has no microphone gate to open. */
  blab?: {
    micStatus(): Promise<MicStatus>;
    requestMic(): Promise<boolean>;
    openMicSettings(): Promise<void>;
  };
}
