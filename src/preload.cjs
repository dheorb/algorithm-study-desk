const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studyRecord', {
  load: () => ipcRenderer.invoke('study:load'),
  save: (draft) => ipcRenderer.invoke('study:save', { id: draft?.id, code: draft?.code, notes: draft?.notes }),
  create: (title) => ipcRenderer.invoke('study:create', title)
});
