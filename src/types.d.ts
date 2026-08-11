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

  /** Absent in Firefox and Safari, which is why every caller has a fallback. */
  showSaveFilePicker?(options?: {
    id?: string;
    suggestedName?: string;
    startIn?: string | FileSystemHandle;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle>;

  /** Present only in the desktop app. The browser build has no microphone gate to open. */
  blab?: {
    micStatus(): Promise<MicStatus>;
    requestMic(): Promise<boolean>;
    openMicSettings(): Promise<void>;
  };
}
