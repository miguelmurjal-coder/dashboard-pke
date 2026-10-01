// Replace only PanelAlert.gs with this file; keep Code.gs and PanelChat.gs.
function sharedPanelAlert_(p) {
  if (p.action === 'alertRead') {
    const state = JSON.parse(PropertiesService.getScriptProperties().getProperty('PKE_PANEL_ALERT') || '{"sequence":0,"events":[]}');
    const now = Date.now();
    const after = Number(p.after);
    return { ok: true, sequence: state.sequence, events: p.after === undefined ? [] : state.events.filter(event => now - event.at < 60000 && event.sequence > after) };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Alerta ocupado. Tenta novamente.');
  try {
    const props = PropertiesService.getScriptProperties();
    const state = JSON.parse(props.getProperty('PKE_PANEL_ALERT') || '{"sequence":0,"events":[]}');
    const now = Date.now();
    state.events = state.events.filter(event => now - event.at < 60000);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(p.id || ''))) throw new Error('ID de alerta inválido.');
    const existing = state.events.find(event => event.id === p.id);
    if (existing) return { ok: true, event: existing, sequence: state.sequence };
    if (now - (state.lastSentAt || 0) < 3000) throw new Error('Espera alguns segundos antes de enviar outro alerta.');
    const event = { id: p.id, sequence: state.sequence + 1, at: now };
    state.sequence = event.sequence;
    state.lastSentAt = now;
    state.events.push(event);
    state.events = state.events.slice(-20);
    props.setProperty('PKE_PANEL_ALERT', JSON.stringify(state));
    return { ok: true, event: event, sequence: state.sequence };
  } finally {
    lock.releaseLock();
  }
}
