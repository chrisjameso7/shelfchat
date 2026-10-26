export interface Vibe {
  id: string;
  label: string;
  terms: string[];
}
export const VIBES: Vibe[];
export function getVibe(id?: string | null): Vibe | null;
