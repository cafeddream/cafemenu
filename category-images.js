export const CATEGORY_IMAGES = {
  Combos: "./assets/categories/combos.jpg",
  Tea: "./assets/categories/tea.jpg",
  "Hot Coffee": "./assets/categories/hot-coffee.jpg",
  "Cold Coffee": "./assets/categories/cold-coffee.jpg",
  Mojito: "./assets/categories/mojito.jpg",
  Shakes: "./assets/categories/shakes.jpg",
  "Boost Bar": "./assets/categories/soft-drinks.jpg",
  Starters: "./assets/categories/starters.jpg",
  Pasta: "./assets/categories/pasta.jpg",
  Noodles: "./assets/categories/noodles.jpg",
  "Garlic Breads": "./assets/categories/garlic-bread.jpg",
  Burgers: "./assets/categories/burgers.jpg",
  Sandwiches: "./assets/categories/sandwiches.jpg",
  Momos: "./assets/categories/momos.jpg",
  Maggi: "./assets/categories/maggi.jpg",
  "Ice Cream": "./assets/categories/ice-cream.jpg",
  Pizza: "./assets/categories/pizza.jpg"
};

export function getCategoryImage(category) {
  return CATEGORY_IMAGES[category] || "./assets/categories/default.jpg";
}

export const CATEGORY_IMAGE_PATHS = [
  ...Object.values(CATEGORY_IMAGES),
  "./assets/categories/default.jpg"
];
