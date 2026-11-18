// Flags de funcionalidades que se apagan por defecto hasta que estén listas para producción.

function isOn(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

// /panel (onboarding autoservicio multi-empresa). Apagado salvo PANEL_ENABLED=true:
// el catálogo todavía es global (handleMessage no recibe tenantId), así que un tenant
// nuevo respondería a sus clientes con productos, precios y links de Blue Fishing.
function panelEnabled(env = process.env) {
  return isOn(env.PANEL_ENABLED);
}

module.exports = { isOn, panelEnabled };
