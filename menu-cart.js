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

// Renders main section tabs (Combos / Drinks / Food / Pizza).
export function renderSectionTabs(container, sections, activeSectionId, onSelect) {
  container.innerHTML = sections.map((section) => `
    <button
      class="section-tab ${section.id === activeSectionId ? "active" : ""}"
      type="button"
      role="tab"
      aria-selected="${section.id === activeSectionId}"
      data-section="${escapeHtml(section.id)}"
    >
      <img class="section-tab-icon" src="${escapeHtml(section.image)}" alt="" width="28" height="28" loading="lazy">
      <span>${escapeHtml(section.label)}</span>
    </button>
  `).join("");

  container.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.section));
  });
}

function renderCategoryPills(container, categories, activeCategory, onSelect, compact) {
  const pillClass = compact ? "pill pill-compact" : "pill";
  const iconSize = compact ? 36 : 44;

  container.innerHTML = categories.map((category) => `
    <button class="${pillClass} ${category === activeCategory ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">
      <img class="pill-icon" src="${escapeHtml(getCategoryImage(category))}" alt="" width="${iconSize}" height="${iconSize}" loading="lazy">
      <span class="pill-label">${escapeHtml(category)}</span>
    </button>
  `).join("");

  container.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.category));
  });
}

// Renders horizontal category pills (admin / legacy).
export function renderCategoryRow(container, categories, activeCategory, onSelect) {
  container.classList.remove("category-grid");
  container.classList.add("category-row");
  renderCategoryPills(container, categories, activeCategory, onSelect, false);
}

// Renders a compact category grid for the customer menu.
export function renderCategoryGrid(container, categories, activeCategory, onSelect) {
  container.classList.remove("category-row");
  container.classList.add("category-grid");
  renderCategoryPills(container, categories, activeCategory, onSelect, true);
}

// Renders menu item cards with quantity controls.
export function renderMenuList(container, items, cart, onQtyChange, leadingHtml = "") {
  const cards = items.map((item) => {
    const key = makeItemKey(item);
    const qty = cart.get(key)?.qty || 0;
    return `
      <article class="item-card">
        <div>
          <h3 class="item-name">${escapeHtml(item.name)}</h3>
          <div class="item-price">${formatCurrency(item.price)}</div>
        </div>
        <div class="qty-control" data-key="${escapeHtml(key)}">
          <button class="qty-btn" type="button" data-action="minus" aria-label="Remove ${escapeHtml(item.name)}">-</button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn" type="button" data-action="plus" aria-label="Add ${escapeHtml(item.name)}">+</button>
        </div>
      </article>
    `;
  }).join("");

  container.innerHTML = `${leadingHtml}${cards}`;

  container.querySelectorAll(".qty-control").forEach((control) => {
    const item = items.find((candidate) => makeItemKey(candidate) === control.dataset.key);
    control.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      onQtyChange(item, action === "plus" ? 1 : -1);
    });
  });
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
