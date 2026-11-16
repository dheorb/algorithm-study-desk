const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studyRecord', {
  load: () => ipcRenderer.invoke('study:load'),
  save: (draft) => ipcRenderer.invoke('study:save', {
    id: draft?.id, code: draft?.code, notes: draft?.notes,
    idea: draft?.idea == null ? null : { id: draft.idea.id, body: draft.idea.body }
  }),
  create: (title) => ipcRenderer.invoke('study:create', title),
  createIdea: (problemId, retryIdeaId) => ipcRenderer.invoke('study:create-idea', problemId, retryIdeaId)
});
