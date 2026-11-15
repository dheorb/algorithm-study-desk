const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studyRecord', {
  load: () => ipcRenderer.invoke('study:load'),
  save: (draft) => ipcRenderer.invoke('study:save', { code: draft.code, notes: draft.notes })
});
