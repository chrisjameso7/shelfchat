export const TECHNICAL_TITLE = "\\m(calculus|algebra|trigonometry|geometry|textbook|engineering|electrical|thermodynamics|auction|seed catalogue|price list|annual report)\\M";
export function isLiterary(book) {
  return ["Fiction", "Poetry", "Philosophy", "Essays"].includes(book.category) &&
    !/\b(calculus|algebra|trigonometry|geometry|textbook|engineering|electrical|thermodynamics|auction|seed catalogue|price list|annual report)\b/i.test(book.title);
}
