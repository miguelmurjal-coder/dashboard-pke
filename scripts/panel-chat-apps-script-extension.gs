// Add as a NEW PanelChat.gs file in the existing Apps Script project.
// Keep Code.gs, PanelAlert.gs and all other files.
// In the existing doGet(e), after token validation, add ONLY:
// if (p.action === 'chatRead' || p.action === 'chatSend') {
//   return taskLogJsonp_(callback, sharedPanelChat_(p));
// }
// Then update the existing deployment to a new version, keeping its URL.
function sharedPanelChat_(p) {
  const validId = value => /^[a-zA-Z0-9-]{16,80}$/.test(String(value || ''));
  if (!validId(p.client) || !validId(p.visitor)) throw new Error('Sessão de chat inválida. Atualiza a página.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Chat ocupado. Tenta novamente.');
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const visits = props.getProperties();
    const state = JSON.parse(visits.PKE_PANEL_CHAT || '{"revision":0,"messages":[]}');
    state.messages = state.messages.filter(message => now - message.at < 24 * 60 * 60 * 1000);
    const prefix = 'PKE_PANEL_VISIT_';
    const visitors = {};
    Object.keys(visits).forEach(key => {
      if (key.indexOf(prefix) !== 0) return;
      let visit;
      try { visit = JSON.parse(visits[key]); } catch (_) {}
      if (!visit || !validId(visit.visitor) || now - visit.at >= 90000) props.deleteProperty(key);
      else if (!visitors[visit.visitor] || visit.at > visitors[visit.visitor].at) {
        visitors[visit.visitor] = { name: String(visit.name || '').slice(0, 24), at: visit.at };
      }
    });
    // Older deployed clients omit name; preserve the last known nickname for them.
    const nickname = p.name === undefined ? (visitors[p.visitor] && visitors[p.visitor].name || '') : String(p.name).trim();
    if (nickname.length > 24) throw new Error('Preenche o nickname com até 24 caracteres.');
    props.setProperty(prefix + p.client, JSON.stringify({ visitor: p.visitor, name: nickname, at: now }));
    visitors[p.visitor] = { name: nickname, at: now };
    if (p.action === 'chatSend') {
      const name = String(p.name || '').trim();
      const text = String(p.text || '').trim();
      if (!validId(p.id) || !name || name.length > 24 || !text || text.length > 280) throw new Error('Preenche o nome (até 24 caracteres) e a mensagem (até 280).');
      const existing = state.messages.find(message => message.id === p.id);
      if (!existing) {
        const previous = state.messages.filter(message => message.visitor === p.visitor).pop();
        if (previous && now - previous.at < 2000) throw new Error('Espera 2 segundos antes de enviar outra mensagem.');
        state.revision += 1;
        state.messages.push({ id: p.id, visitor: p.visitor, name: name, text: text, at: now });
        state.messages = state.messages.slice(-30);
      }
    }
    // Apps Script limits each property to 9 KB; bound UTF-8 size, including emoji.
    let serialized = JSON.stringify(state);
    while (Utilities.newBlob(serialized).getBytes().length > 8000 && state.messages.length) {
      state.messages.shift();
      serialized = JSON.stringify(state);
    }
    if (p.action === 'chatSend') props.setProperty('PKE_PANEL_CHAT', serialized);
    return {
      ok: true, revision: state.revision, online: Object.keys(visitors).length,
      users: Object.keys(visitors).map(id => visitors[id].name || 'Sem nickname').sort((a, b) => a.localeCompare(b, 'pt')),
      messages: state.messages.map(message => ({ id: message.id, name: message.name, text: message.text, at: message.at }))
    };
  } finally { lock.releaseLock(); }
}
