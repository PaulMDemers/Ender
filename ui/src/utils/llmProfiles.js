export function formatLlmProfileOption(profile) {
  const label = String(profile?.label || profile?.backend || "Server default").trim();
  const normalizedLabel = label.toLowerCase();
  const model = String(profile?.model || "").trim();
  const backend = String(profile?.backend || "").trim();
  const parts = [label];

  if (model && !normalizedLabel.includes(model.toLowerCase())) parts.push(model);
  if (backend && !normalizedLabel.includes(backend.toLowerCase())) parts.push(backend);
  if (profile?.ready === false) parts.push("needs setup");

  return parts.join(" · ");
}
