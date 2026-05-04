(() => {
  const bootRoot = document.querySelector("[data-move-app]");

  if (!bootRoot) {
    const retries = (window.__moveOptimizeBootRetries || 0) + 1;
    window.__moveOptimizeBootRetries = retries;
    if (retries < 80) {
      window.setTimeout(() => {
        const script = document.createElement("script");
        script.src = `/pages/home.js?retry=${retries}`;
        document.head.appendChild(script);
      }, 25);
    }
    return;
  }

  const root = bootRoot;

  if (root.dataset.ready === "true") {
    return;
  }

  root.dataset.ready = "true";

  const DB_NAME = "moveoptimize-db";
  const DB_VERSION = 1;
  const STORE_NAME = "app-state";
  const STATE_KEY = "state";
  const PLACEHOLDER_IMAGE = "/assets/box-placeholder.svg";
  const LONG_PRESS_MS = 500;
  const BOX_SCALE_OPTIONS = [1, 1.25, 1.5, 1.75, 2];

  const organizerList = root.querySelector("#organizerList");
  const categoryToggle = root.querySelector("#categoryToggle");
  const summary = root.querySelector("[data-summary]");
  const categoryDuplicateWarning = root.querySelector("#categoryDuplicateWarning");
  const bulkActions = root.querySelector("#bulkActions");
  const cameraInput = root.querySelector("#cameraInput");
  const galleryInput = root.querySelector("#galleryInput");
  const confirmModal = root.querySelector("#confirmModal");
  const confirmMessage = root.querySelector("#confirmMessage");
  const photoModal = root.querySelector("#photoModal");
  const photoPreview = root.querySelector("#photoPreview");
  const lightboxModal = root.querySelector("#lightboxModal");
  const lightboxImage = root.querySelector("#lightboxImage");
  const categoryDeleteModal = root.querySelector("#categoryDeleteModal");
  const categoryDeleteSubtitle = root.querySelector("#categoryDeleteSubtitle");
  const overlayBoxList = root.querySelector("#overlayBoxList");
  const overlayCategoryList = root.querySelector("#overlayCategoryList");

  let db;
  let state;
  let saveTimer;
  let activeLineKey = "root-end";
  let selectedBoxIds = new Set();
  let imageUrls = new Map();
  let pendingPhoto = null;
  let activePhotoBoxId = null;
  let confirmResolver = null;
  let deletionCategoryId = null;
  let overlaySelectedIds = new Set();
  let pressState = null;
  let dragState = null;
  let suppressClick = false;
  let categoryDragCollapseState = null;

  const emptyState = () => ({
    categoriesVisible: true,
    categories: [],
    boxes: [],
    layout: [],
    meta: {
      availableCategoryNumbers: [],
      availableBoxNumbers: [],
      nextBoxNumber: 1,
      nextCategoryNumber: 1,
      universalBoxScaleSourceId: null
    }
  });

  const uid = (prefix) => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

  const escapeHtml = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const byOrder = (left, right) => (left.order ?? 0) - (right.order ?? 0) || (left.createdAt ?? 0) - (right.createdAt ?? 0);
  const extractBoxNumber = (name = "") => {
    const match = /^Box\s+(\d+)$/i.exec(String(name).trim());
    return match ? Number.parseInt(match[1], 10) : null;
  };
  const extractCategoryNumber = (name = "") => {
    const match = /^Category\s+(\d+)$/i.exec(String(name).trim());
    return match ? Number.parseInt(match[1], 10) : null;
  };

  const findCategory = (categoryId) => state.categories.find((category) => category.id === categoryId);
  const findBox = (boxId) => state.boxes.find((box) => box.id === boxId);
  const normalizeBoxScale = (value) => {
    const parsed = Number.parseFloat(value);
    return BOX_SCALE_OPTIONS.includes(parsed) ? parsed : 1;
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function readStoredState() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(STATE_KEY);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function writeStoredState() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(state, STATE_KEY);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeStoredState().catch((error) => console.error("MoveOptimize failed to save state", error));
    }, 120);
  }

  function normalizeState() {
    state = state || emptyState();
    state.categories = Array.isArray(state.categories) ? state.categories : [];
    state.boxes = Array.isArray(state.boxes) ? state.boxes : [];
    state.layout = Array.isArray(state.layout) ? state.layout : [];
    state.meta = state.meta || { availableCategoryNumbers: [], availableBoxNumbers: [], nextBoxNumber: 1, nextCategoryNumber: 1, universalBoxScaleSourceId: null };
    state.meta.availableCategoryNumbers = Array.isArray(state.meta.availableCategoryNumbers) ? state.meta.availableCategoryNumbers : [];
    state.meta.availableBoxNumbers = Array.isArray(state.meta.availableBoxNumbers) ? state.meta.availableBoxNumbers : [];
    state.meta.universalBoxScaleSourceId = typeof state.meta.universalBoxScaleSourceId === "string" ? state.meta.universalBoxScaleSourceId : null;
    state.categoriesVisible = state.categoriesVisible !== false;

    const categoryIds = new Set(state.categories.map((category) => category.id));
    const usedCategoryNumbers = new Set();
    let inferredNextCategoryNumber = 1;
    const usedBoxNumbers = new Set();
    let inferredNextBoxNumber = 1;

    state.boxes.forEach((box, index) => {
      if (box.categoryId && !categoryIds.has(box.categoryId)) {
        box.categoryId = null;
      }

      let boxNumber = Number.isInteger(box.number) && box.number > 0 ? box.number : extractBoxNumber(box.name);
      if (!boxNumber || usedBoxNumbers.has(boxNumber)) {
        while (usedBoxNumbers.has(inferredNextBoxNumber)) {
          inferredNextBoxNumber += 1;
        }
        boxNumber = inferredNextBoxNumber;
      }

      box.number = boxNumber;
      usedBoxNumbers.add(boxNumber);
      inferredNextBoxNumber = Math.max(inferredNextBoxNumber, boxNumber + 1);
      box.order = Number.isFinite(box.order) ? box.order : (index + 1) * 1000;
      box.name = box.name || `Box ${index + 1}`;
      box.viewScale = normalizeBoxScale(box.viewScale);
    });

    if (state.meta.universalBoxScaleSourceId && !findBox(state.meta.universalBoxScaleSourceId)) {
      state.meta.universalBoxScaleSourceId = null;
    }

    state.meta.availableBoxNumbers = [...new Set(
      state.meta.availableBoxNumbers
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0 && !usedBoxNumbers.has(value))
    )].sort((left, right) => left - right);
    state.meta.nextBoxNumber = Math.max(
      Number.isFinite(state.meta.nextBoxNumber) ? state.meta.nextBoxNumber : 1,
      inferredNextBoxNumber
    );

    state.categories.forEach((category, index) => {
      let categoryNumber = Number.isInteger(category.number) && category.number > 0 ? category.number : extractCategoryNumber(category.name);
      if (!categoryNumber || usedCategoryNumbers.has(categoryNumber)) {
        while (usedCategoryNumbers.has(inferredNextCategoryNumber)) {
          inferredNextCategoryNumber += 1;
        }
        categoryNumber = inferredNextCategoryNumber;
      }

      category.number = categoryNumber;
      usedCategoryNumbers.add(categoryNumber);
      inferredNextCategoryNumber = Math.max(inferredNextCategoryNumber, categoryNumber + 1);
      category.name = category.name || `Category ${categoryNumber}`;
      category.order = Number.isFinite(category.order) ? category.order : (index + 1) * 1000;
      category.collapsed = Boolean(category.collapsed);
    });

    state.meta.availableCategoryNumbers = [...new Set(
      state.meta.availableCategoryNumbers
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0 && !usedCategoryNumbers.has(value))
    )].sort((left, right) => left - right);
    state.meta.nextCategoryNumber = Math.max(
      Number.isFinite(state.meta.nextCategoryNumber) ? state.meta.nextCategoryNumber : 1,
      inferredNextCategoryNumber
    );

    const seenRefs = new Set();
    state.layout = state.layout.filter((ref) => {
      if (!ref || !ref.type || !ref.id) {
        return false;
      }

      const key = `${ref.type}:${ref.id}`;
      if (seenRefs.has(key)) {
        return false;
      }

      if (ref.type === "category" && categoryIds.has(ref.id)) {
        seenRefs.add(key);
        return true;
      }

      const box = findBox(ref.id);
      if (ref.type === "box" && box && !box.categoryId) {
        seenRefs.add(key);
        return true;
      }

      return false;
    });

    state.categories.slice().sort(byOrder).forEach((category) => {
      const key = `category:${category.id}`;
      if (!seenRefs.has(key)) {
        state.layout.push({ type: "category", id: category.id });
        seenRefs.add(key);
      }
    });

    state.boxes.filter((box) => !box.categoryId).sort(byOrder).forEach((box) => {
      const key = `box:${box.id}`;
      if (!seenRefs.has(key)) {
        state.layout.push({ type: "box", id: box.id });
        seenRefs.add(key);
      }
    });

    reindexRootLayout();
    reindexAllBoxOrders();
  }

  function reindexRootLayout() {
    state.layout.forEach((ref, index) => {
      const item = ref.type === "category" ? findCategory(ref.id) : findBox(ref.id);
      if (item) {
        item.order = (index + 1) * 1000;
      }
    });
  }

  function reindexAllBoxOrders() {
    const categoryIds = [null, ...state.categories.map((category) => category.id)];
    categoryIds.forEach((categoryId) => {
      state.boxes
        .filter((box) => (box.categoryId || null) === categoryId)
        .sort(byOrder)
        .forEach((box, index) => {
          box.order = (index + 1) * 1000;
        });
    });
  }

  function contextFromElement(element) {
    return {
      scope: element.dataset.scope || "root-end",
      categoryId: element.dataset.categoryId || null,
      afterType: element.dataset.afterType || null,
      afterId: element.dataset.afterId || null
    };
  }

  function contextKey(context) {
    return [context.scope, context.categoryId || "", context.afterType || "", context.afterId || ""].join(":");
  }

  function contextAttributes(context) {
    return `data-scope="${escapeHtml(context.scope)}" data-category-id="${escapeHtml(context.categoryId || "")}" data-after-type="${escapeHtml(context.afterType || "")}" data-after-id="${escapeHtml(context.afterId || "")}"`;
  }

  function renderInsertLine(context, options = {}) {
    const { compact = false, forceActive = false, extraClass = "" } = options;
    const key = contextKey(context);
    const active = forceActive || activeLineKey === key;
    const controls = state.categoriesVisible
      ? `<div class="insert-actions">
          <button type="button" data-action="new-category" ${contextAttributes(context)}>New Category</button>
          <button type="button" data-action="new-box" ${contextAttributes(context)}>New Box</button>
        </div>`
      : `<div class="insert-actions single">
          <button type="button" data-action="new-box" ${contextAttributes(context)}>New Box</button>
        </div>`;

    return `<div class="insert-wrap ${compact ? "compact" : ""} ${extraClass}">
      <button type="button" class="insert-line ${active ? "active" : ""}" data-action="toggle-line" data-drop="true" ${contextAttributes(context)} aria-label="Add here"></button>
      ${active ? controls : ""}
    </div>`;
  }

  function getRootSegmentBoxIds(startIndex) {
    const boxIds = [];

    for (let index = startIndex; index < state.layout.length; index += 1) {
      const ref = state.layout[index];
      if (ref?.type !== "box") {
        break;
      }

      boxIds.push(ref.id);
    }

    return boxIds;
  }

  function getRootSegmentContext(startIndex) {
    if (startIndex <= 0) {
      return { scope: "root-start" };
    }

    const previousRef = state.layout[startIndex - 1];
    if (!previousRef) {
      return { scope: "root-start" };
    }

    return {
      scope: "root",
      afterType: previousRef.type,
      afterId: previousRef.id
    };
  }

  function renderUncategorizedNotice(startIndex) {
    const boxIds = getRootSegmentBoxIds(startIndex);
    if (!boxIds.length) {
      return "";
    }

    const context = getRootSegmentContext(startIndex);
    const count = boxIds.length;
    const label = count === 1 ? "box below isn't in a category yet" : `${count} boxes below aren't in a category yet`;

    return `<section class="uncategorized-notice">
      <p><strong>Uncategorized:</strong> The ${escapeHtml(label)}.</p>
      <button type="button" data-action="categorize-root-segment" ${contextAttributes(context)}>
        Turn ${count === 1 ? "it" : "them"} into a category
      </button>
    </section>`;
  }

  function renderEmptyRootInsertLines() {
    const rootContext = { scope: "root-end" };
    return `<div class="empty-root-insert-stack">
      ${renderInsertLine(rootContext, { extraClass: "root-leading" })}
      ${renderInsertLine(rootContext, { forceActive: true, extraClass: "root-trailing" })}
    </div>`;
  }

  function cleanupDragArtifacts() {
    document.querySelectorAll(".drag-ghost").forEach((ghost) => ghost.remove());
    document.querySelectorAll(".insert-line.drop-target").forEach((line) => line.classList.remove("drop-target"));
    document.querySelectorAll(".drag-source-hidden").forEach((element) => element.classList.remove("drag-source-hidden"));
    hideRevealedCategoryHandles();
    root.classList.remove("category-dragging");
  }

  function revealCategoryHandle(frame) {
    if (!frame) {
      return;
    }
    hideRevealedCategoryHandles(frame);
    frame.classList.add("touch-handle-visible");
  }

  function hideRevealedCategoryHandles(exceptFrame = null) {
    organizerList.querySelectorAll(".category-drag-frame.touch-handle-visible").forEach((frame) => {
      if (frame !== exceptFrame) {
        frame.classList.remove("touch-handle-visible");
      }
    });
  }

  function collapseCategoriesForDrag() {
    categoryDragCollapseState = new Map(
      state.categories.map((category) => [category.id, category.collapsed])
    );
    state.categories.forEach((category) => {
      category.collapsed = true;
    });
  }

  function restoreCategoriesAfterDrag() {
    if (!categoryDragCollapseState) {
      return;
    }

    state.categories.forEach((category) => {
      if (categoryDragCollapseState.has(category.id)) {
        category.collapsed = categoryDragCollapseState.get(category.id);
      }
    });
    categoryDragCollapseState = null;
  }

  function getBoxImageSrc(box) {
    if (!box.image?.blob) {
      return PLACEHOLDER_IMAGE;
    }

    if (!imageUrls.has(box.id)) {
      imageUrls.set(box.id, URL.createObjectURL(box.image.blob));
    }

    return imageUrls.get(box.id);
  }

  function revokeBoxImage(boxId) {
    const currentUrl = imageUrls.get(boxId);
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      imageUrls.delete(boxId);
    }
  }

  function boxesForCategory(categoryId) {
    return state.boxes.filter((box) => (box.categoryId || null) === (categoryId || null)).sort(byOrder);
  }

  function getDuplicateCategoryIds() {
    const nameGroups = new Map();

    state.categories.forEach((category) => {
      const key = category.name.trim().toLowerCase();
      if (!key) {
        return;
      }

      if (!nameGroups.has(key)) {
        nameGroups.set(key, []);
      }

      nameGroups.get(key).push(category.id);
    });

    return new Set(
      [...nameGroups.values()]
        .filter((ids) => ids.length > 1)
        .flat()
    );
  }

  function getUniversalScaleSourceBox() {
    return state.meta.universalBoxScaleSourceId ? findBox(state.meta.universalBoxScaleSourceId) : null;
  }

  function getEffectiveBoxScale(box) {
    const universalSourceBox = getUniversalScaleSourceBox();
    return universalSourceBox ? normalizeBoxScale(universalSourceBox.viewScale) : normalizeBoxScale(box.viewScale);
  }

  function renderBoxScaleOptions(selectedScale) {
    return BOX_SCALE_OPTIONS.map((scale) => `<option value="${scale}" ${scale === selectedScale ? "selected" : ""}>${scale}x</option>`).join("");
  }

  function renderBox(box, context, options = {}) {
    const selected = selectedBoxIds.has(box.id);
    const category = box.categoryId ? findCategory(box.categoryId) : null;
    const boxScale = normalizeBoxScale(box.viewScale);
    const effectiveScale = getEffectiveBoxScale(box);
    const isUniversalSource = state.meta.universalBoxScaleSourceId === box.id;
    const universalScaleLocked = Boolean(state.meta.universalBoxScaleSourceId && !isUniversalSource);

    return `<article class="box-card ${selected ? "selected" : ""} ${isUniversalSource ? "universal-source" : ""}" style="--box-scale:${escapeHtml(effectiveScale.toFixed(2))}" data-box-id="${escapeHtml(box.id)}" data-category-id="${escapeHtml(box.categoryId || "")}">
      <div class="box-image-shell">
        <img src="${escapeHtml(getBoxImageSrc(box))}" alt="${escapeHtml(box.name)} photo" loading="lazy">
        <button type="button" class="icon-button image-action enlarge" data-action="expand-photo" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Enlarge box photo"><i class="bi bi-arrows-angle-expand"></i></button>
        <button type="button" class="icon-button image-action camera" data-action="camera" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Take box photo"><i class="bi bi-camera-fill"></i></button>
        <button type="button" class="icon-button image-action gallery" data-action="gallery" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Choose box photo"><i class="bi bi-images"></i></button>
        <button type="button" class="icon-button image-action clear" data-action="clear-photo" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Clear box photo"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="box-details">
        <input type="text" value="${escapeHtml(box.name)}" data-action="box-name" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Box name">
        <div class="box-scale-controls">
          <label class="box-scale-select-wrap">
            <i class="bi bi-zoom-in"></i>
            <select data-action="box-scale" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Box size multiplier" ${universalScaleLocked ? "disabled" : ""}>
              ${renderBoxScaleOptions(boxScale)}
            </select>
          </label>
          <label class="box-scale-toggle">
            <input type="checkbox" data-action="box-scale-universal" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" ${isUniversalSource ? "checked" : ""}>
            <span>All boxes</span>
          </label>
        </div>
      </div>
    </article>
    ${renderInsertLine(context)}`;
  }

  function renderCategory(category, options = {}) {
    const categoryBoxes = boxesForCategory(category.id);
    const collapsed = category.collapsed;
    const headerContext = { scope: "category-start", categoryId: category.id, afterType: "category", afterId: category.id };
    const duplicateClass = options.isDuplicate ? " duplicate-category" : "";
    const duplicateInputClass = options.isDuplicate ? " duplicate-category-name" : "";

    const boxesHtml = collapsed ? "" : categoryBoxes.map((box) => renderBox(box, {
      scope: "category",
      categoryId: category.id,
      afterType: "box",
      afterId: box.id
    })).join("");

    return `<section class="category-section${duplicateClass}" data-category-id="${escapeHtml(category.id)}">
      <div class="category-header" data-category-id="${escapeHtml(category.id)}">
        <button type="button" class="icon-button collapse-toggle" data-action="toggle-category" data-category-id="${escapeHtml(category.id)}" data-skip-select="true" aria-label="Toggle category"><i class="bi ${collapsed ? "bi-chevron-right" : "bi-chevron-down"}"></i></button>
        <div class="category-drag-frame${duplicateInputClass}" data-category-id="${escapeHtml(category.id)}" aria-label="Drag category">
          <div class="category-drag-hotspot" data-category-id="${escapeHtml(category.id)}" data-skip-select="true">
            <button type="button" class="category-drag-handle" data-category-id="${escapeHtml(category.id)}" data-skip-select="true" aria-label="Drag category">
              <span aria-hidden="true">•••</span>
            </button>
          </div>
          <input type="text" class="category-name${duplicateInputClass}" value="${escapeHtml(category.name)}" data-action="category-name" data-category-id="${escapeHtml(category.id)}" data-skip-select="true" aria-label="Category name">
        </div>
        <button type="button" class="delete-category" data-action="delete-category" data-category-id="${escapeHtml(category.id)}" data-skip-select="true">Delete</button>
      </div>
      ${renderInsertLine(headerContext)}
      <div class="category-boxes" ${collapsed ? "hidden" : ""}>${boxesHtml}</div>
    </section>`;
  }

  function renderFlatHiddenCategories() {
    const fragments = [];

    state.layout.forEach((ref) => {
      if (ref.type === "box") {
        const box = findBox(ref.id);
        if (box) {
          fragments.push(renderBox(box, { scope: "root-end" }, { flat: true }));
        }
        return;
      }

      if (ref.type === "category") {
        boxesForCategory(ref.id).forEach((box) => {
          fragments.push(renderBox(box, { scope: "root-end" }, { flat: true }));
        });
      }
    });

    return fragments.join("");
  }

  function renderOrganizer() {
    normalizeState();
    cleanupDragArtifacts();
    categoryToggle.checked = state.categoriesVisible;
    const duplicateCategoryIds = getDuplicateCategoryIds();

    const boxCount = state.boxes.length;
    const categoryCount = state.categories.length;
    summary.textContent = `${boxCount} ${boxCount === 1 ? "box" : "boxes"} across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}.`;

    if (categoryDuplicateWarning) {
      if (duplicateCategoryIds.size > 0) {
        const duplicateCount = duplicateCategoryIds.size;
        categoryDuplicateWarning.hidden = false;
        categoryDuplicateWarning.textContent = duplicateCount === 1
          ? "Duplicate category name detected. Rename the highlighted category."
          : "Duplicate category names detected. Rename one of the highlighted categories.";
      } else {
        categoryDuplicateWarning.hidden = true;
        categoryDuplicateWarning.textContent = "";
      }
    }

    const content = state.categoriesVisible
      ? state.layout.map((ref, index) => {
          if (ref.type === "category") {
            const category = findCategory(ref.id);
            return category ? renderCategory(category, { isDuplicate: duplicateCategoryIds.has(category.id) }) : "";
          }

          const box = findBox(ref.id);
          if (!box) {
            return "";
          }

          const startsRootBoxSegment = index === 0 || state.layout[index - 1]?.type !== "box";
          const notice = startsRootBoxSegment ? renderUncategorizedNotice(index) : "";
          return `${notice}${renderBox(box, { scope: "root", afterType: "box", afterId: box.id })}`;
        }).join("")
      : renderFlatHiddenCategories();

    const hasContent = Boolean(content);
    const emptyMessage = state.boxes.length === 0 && state.categories.length === 0
      ? `<div class="empty-state"><strong>No boxes yet.</strong></div>`
      : "";

    organizerList.innerHTML = hasContent
      ? `${renderInsertLine({ scope: "root-start" }, { extraClass: "root-leading" })}${content}${renderInsertLine({ scope: "root-end" }, { forceActive: true, extraClass: "root-trailing" })}`
      : `${emptyMessage}${renderEmptyRootInsertLines()}`;
    bulkActions.hidden = selectedBoxIds.size === 0;
    renderCategoryDeleteOverlay();
  }

  function getRootInsertIndex(context) {
    if (context?.scope === "root-start") {
      return 0;
    }

    if (!context || context.scope === "root-end") {
      return state.layout.length;
    }

    if (context.afterType && context.afterId) {
      const index = state.layout.findIndex((ref) => ref.type === context.afterType && ref.id === context.afterId);
      return index >= 0 ? index + 1 : state.layout.length;
    }

    return state.layout.length;
  }

  function insertRootRef(ref, index) {
    state.layout = state.layout.filter((item) => !(item.type === ref.type && item.id === ref.id));
    const safeIndex = Math.max(0, Math.min(index, state.layout.length));
    state.layout.splice(safeIndex, 0, ref);
    reindexRootLayout();
  }

  function insertBoxesInCategory(boxIds, categoryId, afterBoxId = null) {
    const ordered = boxesForCategory(categoryId).filter((box) => !boxIds.includes(box.id));
    const insertIndex = afterBoxId ? ordered.findIndex((box) => box.id === afterBoxId) + 1 : 0;
    const safeIndex = insertIndex > 0 ? insertIndex : 0;
    const moving = boxIds.map(findBox).filter(Boolean);
    ordered.splice(safeIndex, 0, ...moving);
    ordered.forEach((box, index) => {
      box.categoryId = categoryId;
      box.order = (index + 1) * 1000;
    });
  }

  function claimNextBoxNumber() {
    const availableNumber = state.meta.availableBoxNumbers.shift();
    if (Number.isInteger(availableNumber) && availableNumber > 0) {
      return availableNumber;
    }

    const boxNumber = Number.isFinite(state.meta.nextBoxNumber) && state.meta.nextBoxNumber > 0 ? state.meta.nextBoxNumber : 1;
    state.meta.nextBoxNumber = boxNumber + 1;
    return boxNumber;
  }

  function recycleBoxNumbers(boxIds) {
    const remainingBoxIds = new Set(state.boxes.filter((box) => !boxIds.includes(box.id)).map((box) => box.id));
    const remainingNumbers = new Set(
      state.boxes
        .filter((box) => remainingBoxIds.has(box.id))
        .map((box) => box.number)
        .filter((value) => Number.isInteger(value) && value > 0)
    );
    const recycledNumbers = boxIds
      .map(findBox)
      .map((box) => box?.number)
      .filter((value) => Number.isInteger(value) && value > 0 && !remainingNumbers.has(value));

    state.meta.availableBoxNumbers = [...new Set([
      ...state.meta.availableBoxNumbers,
      ...recycledNumbers
    ])].sort((left, right) => left - right);
  }

  function claimNextCategoryNumber() {
    const availableNumber = state.meta.availableCategoryNumbers.shift();
    if (Number.isInteger(availableNumber) && availableNumber > 0) {
      return availableNumber;
    }

    const categoryNumber = Number.isFinite(state.meta.nextCategoryNumber) && state.meta.nextCategoryNumber > 0 ? state.meta.nextCategoryNumber : 1;
    state.meta.nextCategoryNumber = categoryNumber + 1;
    return categoryNumber;
  }

  function recycleCategoryNumber(categoryId) {
    const category = findCategory(categoryId);
    const categoryNumber = category?.number;
    if (!Number.isInteger(categoryNumber) || categoryNumber <= 0) {
      return;
    }

    const remainingNumbers = new Set(
      state.categories
        .filter((item) => item.id !== categoryId)
        .map((item) => item.number)
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    if (remainingNumbers.has(categoryNumber)) {
      return;
    }

    state.meta.availableCategoryNumbers = [...new Set([
      ...state.meta.availableCategoryNumbers,
      categoryNumber
    ])].sort((left, right) => left - right);
  }

  function moveRootSegmentIntoCategory(insertIndex, categoryId) {
    const boxIds = getRootSegmentBoxIds(insertIndex);
    if (!boxIds.length) {
      return;
    }

    state.layout = state.layout.filter((ref) => !(ref.type === "box" && boxIds.includes(ref.id)));
    boxIds.forEach((boxId) => {
      const box = findBox(boxId);
      if (box) {
        box.categoryId = categoryId;
      }
    });
    insertBoxesInCategory(boxIds, categoryId, null);
  }

  function moveFollowingRootBoxIntoCategory(insertIndex, categoryId) {
    const [firstBoxId] = getRootSegmentBoxIds(insertIndex);
    if (!firstBoxId) {
      return;
    }

    state.layout = state.layout.filter((ref) => !(ref.type === "box" && ref.id === firstBoxId));
    const box = findBox(firstBoxId);
    if (!box) {
      return;
    }

    box.categoryId = categoryId;
    insertBoxesInCategory([firstBoxId], categoryId, null);
  }

  function addCategory(context, options = {}) {
    if (!state.categoriesVisible) {
      return;
    }

    const categoryNumber = claimNextCategoryNumber();
    const id = uid("category");
    const category = {
      id,
      number: categoryNumber,
      name: `Category ${categoryNumber}`,
      collapsed: false,
      order: Date.now(),
      createdAt: Date.now()
    };

    state.categories.push(category);
    if (context.scope === "category" && context.categoryId) {
      const sourceCategoryId = context.categoryId;
      const sourceCategoryBoxes = boxesForCategory(sourceCategoryId);
      const splitIndex = context.afterId
        ? sourceCategoryBoxes.findIndex((box) => box.id === context.afterId) + 1
        : 0;
      const movingBoxIds = sourceCategoryBoxes.slice(Math.max(0, splitIndex)).map((box) => box.id);
      const sourceCategoryIndex = state.layout.findIndex((ref) => ref.type === "category" && ref.id === sourceCategoryId);

      insertRootRef({ type: "category", id }, sourceCategoryIndex >= 0 ? sourceCategoryIndex + 1 : getRootInsertIndex(context));

      if (movingBoxIds.length > 0) {
        movingBoxIds.forEach((boxId) => {
          const box = findBox(boxId);
          if (box) {
            box.categoryId = id;
          }
        });
        insertBoxesInCategory(movingBoxIds, id, null);
      }
    } else {
      const insertIndex = getRootInsertIndex(context);
      insertRootRef({ type: "category", id }, insertIndex);
      if (options.captureRootSegment) {
        moveRootSegmentIntoCategory(insertIndex + 1, id);
      } else {
        moveFollowingRootBoxIntoCategory(insertIndex + 1, id);
      }
    }

    activeLineKey = "";
    scheduleSave();
    renderOrganizer();
    window.setTimeout(() => {
      activeLineKey = "";
      renderOrganizer();
      focusCategory(id);
    }, 0);
  }

  function addBox(context) {
    const insertionContext = resolveBoxInsertionContext(context);
    const boxNumber = claimNextBoxNumber();
    const id = uid("box");
    const box = {
      id,
      number: boxNumber,
      name: `Box ${boxNumber}`,
      categoryId: null,
      order: Date.now(),
      createdAt: Date.now(),
      image: null,
      viewScale: 1
    };

    state.boxes.push(box);

    if (state.categoriesVisible && (insertionContext.scope === "category" || insertionContext.scope === "category-start") && insertionContext.categoryId) {
      box.categoryId = insertionContext.categoryId;
      insertBoxesInCategory([id], insertionContext.categoryId, insertionContext.scope === "category" ? insertionContext.afterId : null);
    } else {
      box.categoryId = null;
      const insertIndex = state.categoriesVisible ? getRootInsertIndex(insertionContext) : state.layout.length;
      insertRootRef({ type: "box", id }, insertIndex);
    }

    selectedBoxIds.clear();
    activeLineKey = "";
    scheduleSave();
    renderOrganizer();
    window.setTimeout(() => {
      activeLineKey = "";
      renderOrganizer();
      focusBox(id);
    }, 0);
  }

  function resolveBoxInsertionContext(context) {
    if (!state.categoriesVisible || context.scope !== "root-end") {
      return context;
    }

    const lastRef = state.layout[state.layout.length - 1];
    if (lastRef?.type !== "category") {
      return context;
    }

    const categoryId = lastRef.id;
    const categoryBoxes = boxesForCategory(categoryId);
    const lastBox = categoryBoxes[categoryBoxes.length - 1];

    return lastBox
      ? { scope: "category", categoryId, afterType: "box", afterId: lastBox.id }
      : { scope: "category-start", categoryId, afterType: "category", afterId: categoryId };
  }

  function focusCategory(categoryId) {
    requestAnimationFrame(() => {
      const input = organizerList.querySelector(`[data-action="category-name"][data-category-id="${CSS.escape(categoryId)}"]`);
      input?.focus();
      input?.select();
    });
  }

  function focusBox(boxId) {
    requestAnimationFrame(() => {
      const input = organizerList.querySelector(`[data-action="box-name"][data-box-id="${CSS.escape(boxId)}"]`);
      input?.focus();
      input?.select();
    });
  }

  function removeBoxes(boxIds) {
    recycleBoxNumbers(boxIds);
    boxIds.forEach(revokeBoxImage);
    state.boxes = state.boxes.filter((box) => !boxIds.includes(box.id));
    if (state.meta.universalBoxScaleSourceId && boxIds.includes(state.meta.universalBoxScaleSourceId)) {
      state.meta.universalBoxScaleSourceId = null;
    }
    state.layout = state.layout.filter((ref) => !(ref.type === "box" && boxIds.includes(ref.id)));
    selectedBoxIds = new Set([...selectedBoxIds].filter((id) => !boxIds.includes(id)));
    overlaySelectedIds = new Set([...overlaySelectedIds].filter((id) => !boxIds.includes(id)));
    normalizeState();
  }

  function deleteCategoryIfEmpty(categoryId) {
    if (boxesForCategory(categoryId).length > 0) {
      return false;
    }

    recycleCategoryNumber(categoryId);
    state.categories = state.categories.filter((category) => category.id !== categoryId);
    state.layout = state.layout.filter((ref) => !(ref.type === "category" && ref.id === categoryId));
    if (deletionCategoryId === categoryId) {
      deletionCategoryId = null;
      overlaySelectedIds.clear();
      categoryDeleteModal.hidden = true;
    }
    normalizeState();
    scheduleSave();
    renderOrganizer();
    return true;
  }

  async function askConfirm(message) {
    confirmMessage.textContent = message || "This action will update your organizer.";
    confirmModal.hidden = false;
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function resolveConfirm(value) {
    confirmModal.hidden = true;
    if (confirmResolver) {
      confirmResolver(value);
      confirmResolver = null;
    }
  }

  function openCamera(boxId) {
    activePhotoBoxId = boxId;
    cameraInput.value = "";
    cameraInput.click();
  }

  function openGallery(boxId) {
    activePhotoBoxId = boxId;
    galleryInput.value = "";
    galleryInput.click();
  }

  function showPhotoPreview(boxId, file) {
    if (pendingPhoto?.url) {
      URL.revokeObjectURL(pendingPhoto.url);
    }

    pendingPhoto = {
      boxId,
      file,
      url: URL.createObjectURL(file)
    };

    photoPreview.src = pendingPhoto.url;
    photoModal.hidden = false;
  }

  async function applyImageToBox(boxId, file) {
    const box = findBox(boxId);
    if (!box || !file) {
      return;
    }

    revokeBoxImage(boxId);
    box.image = {
      blob: file,
      type: file.type,
      name: file.name,
      updatedAt: Date.now()
    };
    scheduleSave();
    renderOrganizer();
  }

  function closePhotoPreview() {
    photoModal.hidden = true;
    photoPreview.removeAttribute("src");
    if (pendingPhoto?.url) {
      URL.revokeObjectURL(pendingPhoto.url);
    }
    pendingPhoto = null;
  }

  function openImageLightbox(boxId) {
    const box = findBox(boxId);
    if (!box) {
      return;
    }

    lightboxImage.src = getBoxImageSrc(box);
    lightboxImage.alt = `${box.name} enlarged image`;
    lightboxModal.hidden = false;
  }

  function closeImageLightbox() {
    lightboxModal.hidden = true;
    lightboxImage.removeAttribute("src");
    lightboxImage.alt = "";
  }

  function openCategoryDeletion(categoryId) {
    if (deleteCategoryIfEmpty(categoryId)) {
      return;
    }

    deletionCategoryId = categoryId;
    overlaySelectedIds.clear();
    categoryDeleteModal.hidden = false;
    renderCategoryDeleteOverlay();
  }

  function renderCategoryDeleteOverlay() {
    if (!deletionCategoryId || categoryDeleteModal.hidden) {
      return;
    }

    const category = findCategory(deletionCategoryId);
    if (!category) {
      categoryDeleteModal.hidden = true;
      return;
    }

    const boxes = boxesForCategory(deletionCategoryId);
    categoryDeleteSubtitle.textContent = `${category.name} has ${boxes.length} ${boxes.length === 1 ? "box" : "boxes"}.`;

    const selectButton = categoryDeleteModal.querySelector("[data-action='overlay-select-all']");
    selectButton.textContent = overlaySelectedIds.size > 0 ? "Un-select All" : "Select All";

    overlayBoxList.innerHTML = boxes.length
      ? boxes.map((box) => `<button type="button" class="overlay-box ${overlaySelectedIds.has(box.id) ? "selected" : ""}" data-action="overlay-toggle-box" data-box-id="${escapeHtml(box.id)}">
          <img src="${escapeHtml(getBoxImageSrc(box))}" alt="">
          <span>${escapeHtml(box.name)}</span>
        </button>`).join("")
      : `<p class="overlay-empty">No boxes remain.</p>`;

    const targetCategories = state.categories.filter((target) => target.id !== deletionCategoryId);
    overlayCategoryList.innerHTML = targetCategories.length
      ? targetCategories.map((target) => `<button type="button" class="category-target" data-action="overlay-move-to" data-category-id="${escapeHtml(target.id)}">${escapeHtml(target.name)}</button>`).join("")
      : `<p class="overlay-empty">No other categories.</p>`;
  }

  function moveSelectedBoxesToContext(boxIds, context) {
    const movingIds = boxIds.filter((boxId) => Boolean(findBox(boxId)));
    if (movingIds.length === 0) {
      return;
    }

    if (context.afterType === "box" && movingIds.includes(context.afterId)) {
      return;
    }

    state.layout = state.layout.filter((ref) => !(ref.type === "box" && movingIds.includes(ref.id)));

    if (state.categoriesVisible && (context.scope === "category" || context.scope === "category-start") && context.categoryId) {
      movingIds.forEach((boxId) => {
        const box = findBox(boxId);
        if (box) {
          box.categoryId = context.categoryId;
        }
      });
      insertBoxesInCategory(movingIds, context.categoryId, context.scope === "category" ? context.afterId : null);
      return;
    }

    const insertIndex = state.categoriesVisible ? getRootInsertIndex(context) : state.layout.length;
    movingIds.forEach((boxId) => {
      const box = findBox(boxId);
      if (box) {
        box.categoryId = null;
      }
    });
    state.layout.splice(insertIndex, 0, ...movingIds.map((id) => ({ type: "box", id })));
    normalizeState();
  }

  function moveCategoryToContext(categoryId, context) {
    const category = findCategory(categoryId);
    if (!category) {
      return;
    }

    if (context.afterType === "category" && context.afterId === categoryId) {
      return;
    }

    const ref = { type: "category", id: categoryId };
    const targetIndex = getRootInsertIndex(context);
    insertRootRef(ref, targetIndex);
  }

  function startPress(event, type, id) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    pressState = {
      type,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: window.setTimeout(() => beginDrag(event, type, id), LONG_PRESS_MS)
    };
  }

  function cancelPress() {
    if (pressState?.timer) {
      clearTimeout(pressState.timer);
    }
    if (!dragState) {
      cleanupDragArtifacts();
    }
    pressState = null;
  }

  function beginDrag(event, type, id) {
    if (!pressState) {
      return;
    }

    cleanupDragArtifacts();
    window.getSelection?.()?.removeAllRanges();
    if (type === "category") {
      collapseCategoriesForDrag();
      renderOrganizer();
      organizerList.querySelector(`.category-section[data-category-id="${CSS.escape(id)}"]`)?.classList.add("drag-source-hidden");
    }
    suppressClick = true;
    root.classList.toggle("category-dragging", type === "category");
    document.body.classList.add("drag-no-select");

    const ids = [id];
    const ghostState = createDragGhost(type, id, event);
    document.body.appendChild(ghostState.ghost);

    dragState = {
      type,
      ids,
      ghost: ghostState.ghost,
      offsetX: ghostState.offsetX,
      offsetY: ghostState.offsetY,
      dropLine: null,
      dropContext: null,
      x: event.clientX,
      y: event.clientY
    };

    moveGhost(event.clientX, event.clientY);
  }

  function contextBeforeBox(boxId, categoryId) {
    const categoryBoxes = boxesForCategory(categoryId);
    const index = categoryBoxes.findIndex((box) => box.id === boxId);
    if (index <= 0) {
      return { scope: "category-start", categoryId, afterType: "category", afterId: categoryId };
    }

    const previousBox = categoryBoxes[index - 1];
    return { scope: "category", categoryId, afterType: "box", afterId: previousBox.id };
  }

  function contextBeforeRootBox(boxId) {
    const index = state.layout.findIndex((ref) => ref.type === "box" && ref.id === boxId);
    if (index <= 0) {
      return { scope: "root-start" };
    }

    const previousRef = state.layout[index - 1];
    return { scope: "root", afterType: previousRef.type, afterId: previousRef.id };
  }

  function findInsertLineForContext(context) {
    const key = contextKey(context);
    return [...organizerList.querySelectorAll(".insert-line")]
      .find((line) => contextKey(contextFromElement(line)) === key) || null;
  }

  function getDropTargetFromPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);
    const line = elements.find((element) => element.classList?.contains("insert-line"));
    if (line) {
      return { line, context: contextFromElement(line) };
    }

    const boxCard = elements.find((element) => element.classList?.contains("box-card"));
    if (boxCard) {
      const boxId = boxCard.dataset.boxId;
      const categoryId = boxCard.dataset.categoryId || null;
      const rect = boxCard.getBoundingClientRect();
      const dropAfterBox = y >= rect.top + rect.height / 2;
      const context = categoryId
        ? (dropAfterBox ? { scope: "category", categoryId, afterType: "box", afterId: boxId } : contextBeforeBox(boxId, categoryId))
        : (dropAfterBox ? { scope: "root", afterType: "box", afterId: boxId } : contextBeforeRootBox(boxId));

      return { line: findInsertLineForContext(context), context };
    }

    const categoryHeader = elements.find((element) => element.classList?.contains("category-header"));
    if (categoryHeader) {
      const categoryId = categoryHeader.dataset.categoryId;
      const context = { scope: "category-start", categoryId, afterType: "category", afterId: categoryId };
      return { line: findInsertLineForContext(context), context };
    }

    return { line: null, context: null };
  }

  function createDragGhost(type, id, event) {
    if (type === "category") {
      const categoryHeader = organizerList.querySelector(`.category-header[data-category-id="${CSS.escape(id)}"]`);
      if (categoryHeader) {
        const headerRect = categoryHeader.getBoundingClientRect();
        const ghost = document.createElement("div");
        ghost.className = "drag-ghost drag-ghost-category";
        ghost.style.width = `${Math.round(headerRect.width)}px`;

        const headerClone = categoryHeader.cloneNode(true);
        headerClone.querySelectorAll("input").forEach((input) => {
          input.value = input.value;
          input.setAttribute("value", input.value);
        });
        ghost.appendChild(headerClone);

        return {
          ghost,
          offsetX: event.clientX - headerRect.left,
          offsetY: event.clientY - headerRect.top
        };
      }
    }

    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = type === "box" ? `1 box` : findCategory(id)?.name || "Category";

    return {
      ghost,
      offsetX: -14,
      offsetY: -14
    };
  }

  function moveGhost(x, y) {
    if (!dragState) {
      return;
    }

    dragState.ghost.style.transform = `translate(${x - dragState.offsetX}px, ${y - dragState.offsetY}px)`;

    if (y < 80) {
      window.scrollBy(0, -18);
    } else if (window.innerHeight - y < 80) {
      window.scrollBy(0, 18);
    }

    document.querySelectorAll(".insert-line.drop-target").forEach((line) => line.classList.remove("drop-target"));
    const target = getDropTargetFromPoint(x, y);

    dragState.dropLine = target.line;
    dragState.dropContext = target.context;

    if (target.line) {
      target.line.classList.add("drop-target");
    }
  }

  async function finishDrag() {
    if (!dragState) {
      cancelPress();
      return;
    }

    const currentDrag = dragState;
    const context = currentDrag.dropContext || (currentDrag.dropLine ? contextFromElement(currentDrag.dropLine) : null);
    cleanupDragArtifacts();
    dragState = null;
    document.body.classList.remove("drag-no-select");
    cancelPress();

    if (!context) {
      if (currentDrag.type === "box") {
        selectedBoxIds.clear();
      } else {
        restoreCategoriesAfterDrag();
      }
      renderOrganizer();
      return;
    }

    if (currentDrag.type === "box") {
      moveSelectedBoxesToContext(currentDrag.ids, context);
      selectedBoxIds.clear();
      scheduleSave();
      renderOrganizer();
      return;
    }

    const confirmed = await askConfirm("Are you sure?");
    if (!confirmed) {
      restoreCategoriesAfterDrag();
      renderOrganizer();
      return;
    }

    moveCategoryToContext(currentDrag.ids[0], context);
    restoreCategoriesAfterDrag();

    scheduleSave();
    renderOrganizer();
  }

  function handleAction(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement || !root.contains(actionElement)) {
      return;
    }

    const action = actionElement.dataset.action;
    const context = contextFromElement(actionElement);

    if (["toggle-line", "new-category", "new-box", "categorize-root-segment", "expand-photo", "camera", "gallery", "clear-photo", "toggle-category", "delete-category", "bulk-delete", "clear-selection", "close-category-delete", "close-lightbox", "overlay-select-all", "overlay-delete-selected", "overlay-toggle-box", "overlay-move-to"].includes(action)) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (action === "toggle-line") {
      activeLineKey = activeLineKey === contextKey(context) ? "" : contextKey(context);
      renderOrganizer();
      return;
    }

    if (action === "new-category") {
      addCategory(context);
      return;
    }

    if (action === "new-box") {
      addBox(context);
      return;
    }

    if (action === "categorize-root-segment") {
      addCategory(context, { captureRootSegment: true });
      return;
    }

    if (action === "expand-photo") {
      openImageLightbox(actionElement.dataset.boxId);
      return;
    }

    if (action === "camera") {
      openCamera(actionElement.dataset.boxId);
      return;
    }

    if (action === "gallery") {
      openGallery(actionElement.dataset.boxId);
      return;
    }

    if (action === "clear-photo") {
      const box = findBox(actionElement.dataset.boxId);
      if (box) {
        revokeBoxImage(box.id);
        box.image = null;
        scheduleSave();
        renderOrganizer();
      }
      return;
    }

    if (action === "toggle-category") {
      const category = findCategory(actionElement.dataset.categoryId);
      if (category) {
        category.collapsed = !category.collapsed;
        scheduleSave();
        renderOrganizer();
      }
      return;
    }

    if (action === "delete-category") {
      openCategoryDeletion(actionElement.dataset.categoryId);
      return;
    }

    if (action === "bulk-delete") {
      askConfirm("Are you sure?").then((confirmed) => {
        if (confirmed) {
          removeBoxes([...selectedBoxIds]);
          selectedBoxIds.clear();
          scheduleSave();
          renderOrganizer();
        }
      });
      return;
    }

    if (action === "clear-selection") {
      selectedBoxIds.clear();
      renderOrganizer();
      return;
    }

    if (action === "close-category-delete") {
      deletionCategoryId = null;
      overlaySelectedIds.clear();
      categoryDeleteModal.hidden = true;
      return;
    }

    if (action === "close-lightbox") {
      closeImageLightbox();
      return;
    }

    if (action === "overlay-select-all") {
      const boxes = boxesForCategory(deletionCategoryId);
      overlaySelectedIds = overlaySelectedIds.size > 0 ? new Set() : new Set(boxes.map((box) => box.id));
      renderCategoryDeleteOverlay();
      return;
    }

    if (action === "overlay-toggle-box") {
      const boxId = actionElement.dataset.boxId;
      if (overlaySelectedIds.has(boxId)) {
        overlaySelectedIds.delete(boxId);
      } else {
        overlaySelectedIds.add(boxId);
      }
      renderCategoryDeleteOverlay();
      return;
    }

    if (action === "overlay-move-to") {
      const targetCategoryId = actionElement.dataset.categoryId;
      const selected = [...overlaySelectedIds];
      if (!selected.length) {
        return;
      }
      askConfirm("Are you sure?").then((confirmed) => {
        if (!confirmed) {
          renderCategoryDeleteOverlay();
          return;
        }
        selected.forEach((boxId) => {
          const box = findBox(boxId);
          if (box) {
            box.categoryId = targetCategoryId;
            box.order = Date.now();
          }
        });
        insertBoxesInCategory(selected, targetCategoryId, null);
        overlaySelectedIds.clear();
        if (!deleteCategoryIfEmpty(deletionCategoryId)) {
          scheduleSave();
          renderOrganizer();
        }
      });
      return;
    }

    if (action === "overlay-delete-selected") {
      const selected = [...overlaySelectedIds];
      if (!selected.length) {
        return;
      }
      askConfirm("Are you sure?").then((confirmed) => {
        if (!confirmed) {
          renderCategoryDeleteOverlay();
          return;
        }
        removeBoxes(selected);
        overlaySelectedIds.clear();
        if (!deleteCategoryIfEmpty(deletionCategoryId)) {
          scheduleSave();
          renderOrganizer();
        }
      });
    }
  }

  function bindEvents() {
    const finishPointerInteraction = () => {
      if (dragState) {
        finishDrag();
        return;
      }
      cancelPress();
    };

    root.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const boxCard = event.target.closest(".box-card");
      if (boxCard && !event.target.closest("[data-skip-select], button, input, label, select")) {
        const boxId = boxCard.dataset.boxId;
        if (selectedBoxIds.has(boxId)) {
          selectedBoxIds.delete(boxId);
        } else {
          selectedBoxIds.add(boxId);
        }
        renderOrganizer();
        return;
      }

      handleAction(event);
    });

    root.addEventListener("input", (event) => {
      const target = event.target;
      if (target.dataset.action === "category-name") {
        const category = findCategory(target.dataset.categoryId);
        if (category) {
          category.name = target.value.trim() || "Untitled Category";
          scheduleSave();
          summary.textContent = "Saving category...";
        }
      }

      if (target.dataset.action === "box-name") {
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.name = target.value.trim() || "Untitled Box";
          scheduleSave();
          summary.textContent = "Saving box...";
        }
      }

      if (target.dataset.action === "box-scale") {
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.viewScale = normalizeBoxScale(target.value);
          scheduleSave();
          renderOrganizer();
        }
      }
    });

    root.addEventListener("change", (event) => {
      const target = event.target;

      if (target.dataset.action === "box-scale-universal") {
        const boxId = target.dataset.boxId;
        state.meta.universalBoxScaleSourceId = target.checked ? boxId : (state.meta.universalBoxScaleSourceId === boxId ? null : state.meta.universalBoxScaleSourceId);
        scheduleSave();
        renderOrganizer();
      }
    });

    root.addEventListener("keydown", (event) => {
      const target = event.target;
      if (event.key !== "Enter") {
        return;
      }

      if (target.dataset.action === "category-name" || target.dataset.action === "box-name") {
        event.preventDefault();
        event.stopPropagation();
        target.blur();
      }
    });

    root.addEventListener("pointerdown", (event) => {
      const categoryDragFrame = event.target.closest(".category-drag-frame");
      if (!categoryDragFrame) {
        hideRevealedCategoryHandles();
      }

      if (event.target.closest(".insert-line")) {
        return;
      }

      if (event.target.closest(".box-scale-controls")) {
        return;
      }

      const categoryDragHandle = event.target.closest(".category-drag-handle");
      if (categoryDragHandle) {
        event.preventDefault();
        startPress(event, "category", categoryDragHandle.dataset.categoryId);
        return;
      }

      const categoryDragHotspot = event.target.closest(".category-drag-hotspot");
      if (categoryDragHotspot && event.pointerType && event.pointerType !== "mouse") {
        const hotspotFrame = categoryDragHotspot.closest(".category-drag-frame");
        if (hotspotFrame && !hotspotFrame.classList.contains("touch-handle-visible")) {
          event.preventDefault();
          revealCategoryHandle(hotspotFrame);
          return;
        }
      }

      const boxCard = event.target.closest(".box-card");
      if (boxCard) {
        startPress(event, "box", boxCard.dataset.boxId);
        return;
      }

      if (event.target.closest("[data-skip-select], button, input, label, select")) {
        return;
      }
    });

    window.addEventListener("pointermove", (event) => {
      if (pressState && !dragState) {
        const moved = Math.hypot(event.clientX - pressState.startX, event.clientY - pressState.startY);
        if (moved > 12) {
          cancelPress();
        }
      }

      if (dragState) {
        event.preventDefault();
        moveGhost(event.clientX, event.clientY);
      }
    }, { passive: false });

    window.addEventListener("pointerup", finishPointerInteraction);
    window.addEventListener("pointercancel", finishPointerInteraction);
    window.addEventListener("mouseup", finishPointerInteraction);
    document.addEventListener("pointerup", finishPointerInteraction, true);
    document.addEventListener("mouseup", finishPointerInteraction, true);

    categoryToggle.addEventListener("change", () => {
      state.categoriesVisible = categoryToggle.checked;
      activeLineKey = "root-end";
      scheduleSave();
      renderOrganizer();
    });

    confirmModal.addEventListener("click", (event) => {
      const button = event.target.closest("[data-confirm]");
      if (button) {
        resolveConfirm(button.dataset.confirm === "yes");
      }
    });

    cameraInput.addEventListener("change", () => {
      const file = cameraInput.files?.[0];
      if (file && activePhotoBoxId) {
        showPhotoPreview(activePhotoBoxId, file);
      }
    });

    galleryInput.addEventListener("change", () => {
      const file = galleryInput.files?.[0];
      if (file && activePhotoBoxId) {
        applyImageToBox(activePhotoBoxId, file);
      }
    });

    photoModal.addEventListener("click", (event) => {
      const button = event.target.closest("[data-photo]");
      if (!button || !pendingPhoto) {
        return;
      }

      const action = button.dataset.photo;
      if (action === "yes") {
        const { boxId, file } = pendingPhoto;
        closePhotoPreview();
        applyImageToBox(boxId, file);
      }

      if (action === "retry") {
        const boxId = pendingPhoto.boxId;
        closePhotoPreview();
        openCamera(boxId);
      }

      if (action === "cancel") {
        closePhotoPreview();
      }
    });

    lightboxModal.addEventListener("click", (event) => {
      if (event.target === lightboxModal) {
        closeImageLightbox();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !lightboxModal.hidden) {
        closeImageLightbox();
      }
    });
  }

  async function init() {
    db = await openDb();
    state = await readStoredState() || emptyState();
    normalizeState();
    bindEvents();
    renderOrganizer();
  }

  init().catch((error) => {
    console.error("MoveOptimize failed to start", error);
    organizerList.innerHTML = `<div class="empty-state"><strong>MoveOptimize could not start.</strong></div>`;
  });
})();
