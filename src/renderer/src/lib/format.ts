export function providerLabel(provider: string): string {
  if (provider === "notion") return "Notion";
  if (provider === "google_drive") return "Google Drive";
  return provider;
}
