import { getCategoryImage } from "./category-images.js";

export const MENU_SECTIONS = [
  {
    id: "combos",
    label: "Combos",
    image: getCategoryImage("Combos"),
    categories: ["Combos"]
  },
  {
    id: "drinks",
    label: "Drinks",
    image: getCategoryImage("Tea"),
    categories: ["Tea", "Hot Coffee", "Cold Coffee", "Mojito", "Shakes", "Boost Bar"]
  },
  {
    id: "food",
    label: "Food",
    image: getCategoryImage("Starters"),
    categories: [
      "Starters",
      "Pasta",
      "Noodles",
      "Garlic Breads",
      "Burgers",
      "Sandwiches",
      "Momos",
      "Maggi",
      "Ice Cream"
    ]
  },
  {
    id: "pizza",
    label: "Pizza",
    image: getCategoryImage("Pizza"),
    categories: ["Pizza"]
  }
];

export function getSectionForCategory(category) {
  return MENU_SECTIONS.find((section) => section.categories.includes(category)) || MENU_SECTIONS[0];
}

export function getSectionCategories(sectionId, availableCategories) {
  const section = MENU_SECTIONS.find((entry) => entry.id === sectionId);
  if (!section) return [];
  const available = new Set(availableCategories);
  return section.categories.filter((category) => available.has(category));
}

export function getDefaultSectionId(availableCategories) {
  const available = new Set(availableCategories);
  const match = MENU_SECTIONS.find((section) =>
    section.categories.some((category) => available.has(category))
  );
  return match?.id || MENU_SECTIONS[0].id;
}
