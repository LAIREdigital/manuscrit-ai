// Lead capture through the HubSpot Forms API. Unauthenticated endpoint, so no token is needed,
// and the hubspotutk cookie keeps source attribution and fires the portal's existing workflows.

export function formPayload(client, lead, transcript, ctx = {}) {
  const f = client.config.hubspot.fields || {};
  const fields = [
    ["email", lead.email],
    ["firstname", lead.firstname],
    ["lastname", lead.lastname],
    ["company", lead.company],
    [f.transcript || "message", transcriptText(transcript)],
  ]
    .filter(([, v]) => v)
    .map(([name, value]) => ({ objectTypeId: "0-1", name, value: String(value).slice(0, 65000) }));
  const context = { pageUri: ctx.pageUri, pageName: ctx.pageName };
  if (ctx.hutk) context.hutk = ctx.hutk;
  return { fields, context };
}

export function transcriptText(transcript = []) {
  return transcript
    .slice(-30)
    .map((m) => `${m.role === "user" ? "Visitor" : "Bot"}: ${String(m.content).slice(0, 2000)}`)
    .join("\n");
}

export async function submitLead(client, lead, transcript, ctx, fetchImpl = fetch) {
  const { portalId, formGuid } = client.config.hubspot;
  if (!portalId || !formGuid) throw new Error("HubSpot form not configured for this client.");
  const url = `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formPayload(client, lead, transcript, ctx)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${body.slice(0, 300)}`);
  }
  return true;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
