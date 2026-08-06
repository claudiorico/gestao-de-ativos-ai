const DEFAULT_AI_ANALYSIS_EMAILS = [
  "claudiorico81@gmail.com",
  "claudiorico81@hotmail.com",
];

function splitEmails(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedAiAnalysisEmails(): string[] {
  const fromEnv = splitEmails(import.meta.env.VITE_AI_ANALYSIS_EMAILS as string | undefined);
  return Array.from(new Set([...DEFAULT_AI_ANALYSIS_EMAILS, ...fromEnv]));
}

export function canUsePortfolioAi(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAllowedAiAnalysisEmails().includes(email.trim().toLowerCase());
}
