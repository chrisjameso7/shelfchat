// Editorial discovery rules; explicit tags and searchable subject words share existing GIN indexes.
export const VIBES = [
  {
    id: "rainy-sunday",
    label: "Rainy Sunday & Slow Burn",
    terms: ["romance", "love", "courtship", "domestic", "friendship"],
  },
  {
    id: "neon-blues",
    label: "Digital Isolation & Neon Blues",
    terms: [
      "technology",
      "science",
      "alienation",
      "solitude",
      "cities",
      "machines",
    ],
  },
  {
    id: "deep-lore",
    label: "Late Night Brain Rot & Deep Lore",
    terms: [
      "mythology",
      "folklore",
      "fantasy",
      "legends",
      "supernatural",
      "mystery",
    ],
  },
  {
    id: "sharp-wit",
    label: "Quiet Despair & Sharp Wit",
    terms: ["satire", "humor", "comedy", "philosophy", "melancholy", "essays"],
  },
];
export function getVibe(id) {
  if (!id) return null;
  const vibe = VIBES.find((v) => v.id === id);
  if (!vibe)
    throw Object.assign(new Error("Unknown vibe filter."), { status: 400 });
  return vibe;
}
