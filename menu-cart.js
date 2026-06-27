import { escapeHtml, formatCurrency, groupByCategory } from "./firebase.js";
import { getCategoryImage } from "./category-images.js";

// Creates a stable key for menu/cart items.
export function makeItemKey(item) {
  return `${item.name}|${item.price}`;
}

// Returns cart totals for count and amount.
export function getCartTotals(cart) {
  const items = [...cart.values()];
  return {
    items,
    count: items.reduce((sum, item) => sum + item.qty, 0),
    total: items.reduce((sum, item) => sum + item.qty * item.price, 0)
  };
}

// Adds or removes one quantity of an item in the cart map.
export function updateCartItem(cart, item, delta) {
  const key = makeItemKey(item);
  const existing = cart.get(key) || { name: item.name, price: Number(item.price), qty: 0 };
  existing.qty += delta;

  if (existing.qty <= 0) {
    cart.delete(key);
  } else {
    cart.set(key, existing);
  }
}

// Builds grouped menu state from raw menu items.
export function buildMenuState(items) {
  const groupedMenu = groupByCategory(items);
  const categories = Object.keys(groupedMenu);
  return {
    groupedMenu,
    categories,
    activeCategory: categories[0] || ""
  };
}

// Renders horizontal category pills; onSelect receives the category name.
export function renderCategoryRow(container, categories, activeCategory, onSelect) {
  container.innerHTML = categories.map((category) => `
    <button class="pill ${category === activeCategory ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">
      <img class="pill-icon" src="${escapeHtml(getCategoryImage(category))}" alt="" width="44" height="44" loading="lazy">
      <span class="pill-label">${escapeHtml(category)}</span>
    </button>
  `).join("");

  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.category));
  });
}

// Renders vertical category sidebar for the customer menu.
export function renderCategorySidebar(container, categories, activeCategory, onSelect) {
  container.innerHTML = categories.map((category) => `
    <button
      class="sidebar-item ${category === activeCategory ? "active" : ""}"
      type="button"
      data-category="${escapeHtml(category)}"
    >
      <img class="sidebar-item-icon" src="${escapeHtml(getCategoryImage(category))}" alt="" width="36" height="36" loading="lazy">
      <span class="sidebar-item-label">${escapeHtml(category)}</span>
    </button>
  `).join("");

  container.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.category));
  });

  const activeButton = container.querySelector(".sidebar-item.active");
  if (activeButton) {
    activeButton.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function bindQtyControls(container, items, onQtyChange) {
  container.querySelectorAll(".qty-control").forEach((control) => {
    const item = items.find((candidate) => makeItemKey(candidate) === control.dataset.key);
    control.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      onQtyChange(item, action === "plus" ? 1 : -1);
    });
  });
}

// Renders compact item tiles in a grid for the customer menu.
export function renderMenuGrid(container, items, cart, onQtyChange) {
  container.innerHTML = items.map((item) => {
    const key = makeItemKey(item);
    const qty = cart.get(key)?.qty || 0;
    return `
      <article class="menu-tile ${qty > 0 ? "has-qty" : ""}">
        ${qty > 0 ? `<span class="menu-tile-badge">${qty}</span>` : ""}
        <h3 class="menu-tile-name">${escapeHtml(item.name)}</h3>
        <div class="menu-tile-price">${formatCurrency(item.price)}</div>
        <div class="qty-control menu-tile-qty" data-key="${escapeHtml(key)}">
          <button class="qty-btn" type="button" data-action="minus" aria-label="Remove ${escapeHtml(item.name)}">-</button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn" type="button" data-action="plus" aria-label="Add ${escapeHtml(item.name)}">+</button>
        </div>
      </article>
    `;
  }).join("");

  bindQtyControls(container, items, onQtyChange);
}

// Renders menu item cards with quantity controls.
export function renderMenuList(container, items, cart, onQtyChange) {
  if (!items.length) {
    container.innerHTML = "<p class=\"subtle\">No items found.</p>";
    return;
  }

  container.innerHTML = items.map((item) => {
    const key = makeItemKey(item);
    const qty = cart.get(key)?.qty || 0;
    return `
      <article class="item-card">
        <div class="item-card-top">
          <h3 class="item-name">${escapeHtml(item.name)}</h3>
          <div class="qty-control" data-key="${escapeHtml(key)}">
            <button class="qty-btn" type="button" data-action="minus" aria-label="Remove ${escapeHtml(item.name)}">-</button>
            <span class="qty-value">${qty}</span>
            <button class="qty-btn" type="button" data-action="plus" aria-label="Add ${escapeHtml(item.name)}">+</button>
          </div>
        </div>
        <div class="item-price">${formatCurrency(item.price)}</div>
      </article>
    `;
  }).join("");

  bindQtyControls(container, items, onQtyChange);
}

// Renders cart rows with quantity controls.
export function renderCartList(container, cart, onQtyChange) {
  const { items, total } = getCartTotals(cart);
  container.innerHTML = items.map((item) => `
    <article class="cart-row">
      <div>
        <h3 class="item-name">${escapeHtml(item.name)}</h3>
        <div class="row-subtotal">${formatCurrency(item.price)} x ${item.qty} = ${formatCurrency(item.price * item.qty)}</div>
      </div>
      <div class="qty-control" data-key="${escapeHtml(makeItemKey(item))}">
        <button class="qty-btn" type="button" data-action="minus">-</button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" type="button" data-action="plus">+</button>
      </div>
    </article>
  `).join("");

  return { items, total };
}
