/** Item categories — must match the user app's report forms (Users/Frontend MissingItem.tsx / FoundItem.tsx). */
export const ITEM_CATEGORIES = ["Bags & Luggage", "Electronics", "Accessories", "Personal Effects", "Documents & Cards", "Clothing", "Keys", "Valuables", "Others"];

/** Common campus spots offered as suggestions; any free-text location is still accepted. */
export const CAMPUS_LOCATIONS = ["Library", "Gymnasium", "Cafeteria", "Admin Building", "Oval Track", "Engineering Building", "Lost and Found Office"];

/** Categories for a form select, keeping a record's legacy value selectable so editing never silently changes it. */
export function categoryOptions(current?: string) {
  return current && !ITEM_CATEGORIES.includes(current) ? [current, ...ITEM_CATEGORIES] : ITEM_CATEGORIES;
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
