// SPDX-License-Identifier: AGPL-3.0-only
/** Files dropped or pasted into the editor become image or file blocks (uploaded by the host). */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export type FileInsertHandler = (files: File[], at: number | null) => void;

export const FileDrop = Extension.create<{ onFiles: FileInsertHandler | null }>({
  name: 'fileDrop',
  addOptions: () => ({ onFiles: null }),
  addProseMirrorPlugins() {
    const onFiles = this.options.onFiles;
    if (!onFiles) return [];
    return [
      new Plugin({
        key: new PluginKey('fileDrop'),
        props: {
          handleDrop(view, event) {
            const files = [...(event.dataTransfer?.files ?? [])];
            if (!files.length || !view.editable) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            onFiles(files, at?.pos ?? null);
            return true;
          },
          handlePaste(view, event) {
            const files = [...(event.clipboardData?.files ?? [])];
            if (!files.length || !view.editable) return false;
            onFiles(files, null);
            return true;
          },
        },
      }),
    ];
  },
});
