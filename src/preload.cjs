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

contextBridge.exposeInMainWorld('studyChat', {
  load: () => ipcRenderer.invoke('chat:load'),
  send: input => ipcRenderer.invoke('chat:send', {
    id: input?.id, problemId: input?.problemId, question: input?.question,
    code: input?.code, notes: input?.notes,
    idea: input?.idea == null ? null : { id: input.idea.id, body: input.idea.body }
  }),
  cancel: id => ipcRenderer.invoke('chat:cancel', id),
  retrySave: id => ipcRenderer.invoke('chat:retry-save', id),
  onState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('chat:state', handler);
    return () => ipcRenderer.removeListener('chat:state', handler);
  }
});
