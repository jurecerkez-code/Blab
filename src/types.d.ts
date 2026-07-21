// Bits of the File System Access API that TypeScript's lib.dom does not ship yet.
type PermissionDescriptorFS = { mode?: 'read' | 'readwrite' };

interface FileSystemHandle {
  queryPermission?(descriptor?: PermissionDescriptorFS): Promise<PermissionState>;
  requestPermission?(descriptor?: PermissionDescriptorFS): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string | FileSystemHandle;
  }): Promise<FileSystemDirectoryHandle>;
}
