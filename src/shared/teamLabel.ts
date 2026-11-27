/**
 * "Team Otter" for a plain name, but just "Team 1" for a name that already starts with "Team",
 * so copy like "🎉 Team {name}, you're up!" never reads "Team Team 1".
 */
export function teamLabel(name: string): string {
  return /^team\b/i.test(name.trim()) ? name.trim() : `Team ${name}`;
}
