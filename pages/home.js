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
  const THEME_STORAGE_KEY = "moveoptimize-theme";

  const workspace = root.querySelector(".workspace");
  const appToolbar = root.querySelector(".app-toolbar");
  const organizerList = root.querySelector("#organizerList");
  const categoryToggle = root.querySelector("#categoryToggle");
  const autoBoxNumberToggle = root.querySelector("#autoBoxNumberToggle");
  const orderDirectionButton = root.querySelector("#orderDirectionButton");
  const orderDirectionIcon = root.querySelector("#orderDirectionIcon");
  const itemSearchInput = root.querySelector("#itemSearchInput");
  const itemSearchButton = root.querySelector("#itemSearchButton");
  const searchStatus = root.querySelector("#searchStatus");
  const summary = root.querySelector("[data-summary]");
  const categoryDuplicateWarning = root.querySelector("#categoryDuplicateWarning");
  const bulkActions = root.querySelector("#bulkActions");
  const themeToggleButton = root.querySelector("#themeToggleButton");
  const scrollToTopButton = root.querySelector("#scrollToTopButton");
  const scrollToBottomButton = root.querySelector("#scrollToBottomButton");
  const cameraInput = root.querySelector("#cameraInput");
  const galleryInput = root.querySelector("#galleryInput");
  const contentCameraInput = root.querySelector("#contentCameraInput");
  const contentGalleryInput = root.querySelector("#contentGalleryInput");
  const confirmModal = root.querySelector("#confirmModal");
  const confirmMessage = root.querySelector("#confirmMessage");
  const photoModal = root.querySelector("#photoModal");
  const photoPreview = root.querySelector("#photoPreview");
  const boxCreateModal = root.querySelector("#boxCreateModal");
  const boxCreatePreview = root.querySelector("#boxCreatePreview");
  const boxCreateNameInput = root.querySelector("#boxCreateName");
  const boxCreateNumberInput = root.querySelector("#boxCreateNumber");
  const boxCreateError = root.querySelector("#boxCreateError");
  const boxCreateCameraInput = root.querySelector("#boxCreateCameraInput");
  const boxCreateGalleryInput = root.querySelector("#boxCreateGalleryInput");
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
  let selectedContentImageKeys = new Set();
  let pendingSearchJump = null;
  let imageUrls = new Map();
  let pendingPhoto = null;
  let activePhotoBoxId = null;
  let activeContentBoxId = null;
  let confirmResolver = null;
  let deletionCategoryId = null;
  let overlaySelectedIds = new Set();
  let pressState = null;
  let dragState = null;
  let suppressClick = false;
  let categoryDragCollapseState = null;
  let pendingBoxDraft = null;
  let searchStatusMessage = "";
  let autosizeMeasure = null;

  function setTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    if (themeToggleButton) {
      const darkActive = nextTheme === "dark";
      themeToggleButton.setAttribute("aria-pressed", darkActive ? "true" : "false");
      themeToggleButton.setAttribute("aria-label", darkActive ? "Enable light mode" : "Enable dark mode");
      const icon = themeToggleButton.querySelector("i");
      if (icon) {
        icon.className = `bi ${darkActive ? "bi-sun-fill" : "bi-moon-stars"}`;
      }
    }
  }

  function updateLayoutMetrics() {
    if (appToolbar) {
      root.style.setProperty("--app-toolbar-height", `${appToolbar.getBoundingClientRect().height}px`);
    }
  }

  function loadThemePreference() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || "light";
    } catch {
      return "light";
    }
  }

  function persistThemePreference(theme) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures and keep the session theme only.
    }
  }

  const emptyState = () => ({
    categoriesVisible: true,
    categories: [],
    boxes: [],
    layout: [],
    meta: {
      autoBoxNumbers: true,
      boxOrderDirection: "top",
      activeBoxViewId: null,
      availableCategoryNumbers: [],
      availableBoxNumbers: [],
      nextBoxNumber: 1,
      nextCategoryNumber: 1,
      universalBoxScaleSourceId: null,
      contentImageScaleSourceKey: null
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
  const getContentImageScaleKey = (boxId, imageId) => `${boxId}:${imageId}`;

  function getAutosizeMeasure() {
    if (autosizeMeasure) {
      return autosizeMeasure;
    }

    autosizeMeasure = document.createElement("span");
    autosizeMeasure.setAttribute("aria-hidden", "true");
    autosizeMeasure.style.position = "absolute";
    autosizeMeasure.style.visibility = "hidden";
    autosizeMeasure.style.whiteSpace = "pre";
    autosizeMeasure.style.pointerEvents = "none";
    autosizeMeasure.style.left = "-9999px";
    autosizeMeasure.style.top = "0";
    document.body.appendChild(autosizeMeasure);
    return autosizeMeasure;
  }

  function autosizeInput(input) {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    if (["checkbox", "radio", "file", "hidden"].includes(input.type)) {
      return;
    }

    if (!input.dataset.autosizeMin) {
      const renderedWidth = Math.ceil(input.getBoundingClientRect().width);
      if (renderedWidth > 0) {
        input.dataset.autosizeMin = String(renderedWidth);
      }
    }

    const measure = getAutosizeMeasure();
    const computed = window.getComputedStyle(input);
    measure.style.font = computed.font;
    measure.style.fontKerning = computed.fontKerning;
    measure.style.fontVariant = computed.fontVariant;
    measure.style.fontWeight = computed.fontWeight;
    measure.style.letterSpacing = computed.letterSpacing;
    measure.style.textTransform = computed.textTransform;

    const fallbackValue = input.placeholder || input.min || "";
    const text = input.value || fallbackValue || " ";
    measure.textContent = text;

    const padding =
      Number.parseFloat(computed.paddingLeft || "0") +
      Number.parseFloat(computed.paddingRight || "0") +
      Number.parseFloat(computed.borderLeftWidth || "0") +
      Number.parseFloat(computed.borderRightWidth || "0") +
      6;
    const minWidth = Number.parseFloat(input.dataset.autosizeMin || "0");
    const width = Math.ceil(measure.getBoundingClientRect().width + padding);

    input.style.width = `${Math.max(minWidth, width)}px`;
  }

  function autosizeStaticInputs() {
    [itemSearchInput, boxCreateNameInput, boxCreateNumberInput]
      .filter((input) => input instanceof HTMLInputElement && !input.closest("[hidden]"))
      .forEach((input) => autosizeInput(input));
  }

  function autosizeOrganizerInputs() {
    organizerList
      ?.querySelectorAll('[data-action="box-name"], [data-action="box-number"]')
      .forEach((input) => autosizeInput(input));
  }

  function autosizeManagedInputs() {
    autosizeStaticInputs();
    autosizeManagedInputs();
  }

  const findCategory = (categoryId) => state.categories.find((category) => category.id === categoryId);
  const findBox = (boxId) => state.boxes.find((box) => box.id === boxId);
  const boxNumberExists = (boxNumber, excludingBoxId = null) => state.boxes.some((box) => box.id !== excludingBoxId && box.number === boxNumber);
  const normalizeBoxScale = (value) => {
    const parsed = Number.parseFloat(value);
    return BOX_SCALE_OPTIONS.includes(parsed) ? parsed : 1;
  };

  function getOrderedImageBadges(box) {
    const badges = [];

    if (box.fragile) {
      badges.push({
        key: "fragile",
        activatedAt: Number.isFinite(box.fragileActivatedAt) ? box.fragileActivatedAt : 1,
        html: `<div class="box-image-badge box-fragile-badge" aria-label="Fragile package"><i class="bi bi-exclamation-diamond-fill" aria-hidden="true"></i><span>Fragile</span></div>`
      });
    }

    if (box.heavy) {
      badges.push({
        key: "heavy",
        activatedAt: Number.isFinite(box.heavyActivatedAt) ? box.heavyActivatedAt : 2,
        html: `<div class="box-image-badge box-heavy-badge" aria-label="Heavy package"><i class="bi bi-box-seam-fill" aria-hidden="true"></i><span>Heavy</span></div>`
      });
    }

    return badges.sort((left, right) => left.activatedAt - right.activatedAt || left.key.localeCompare(right.key));
  }

  function setSearchStatus(message = "") {
    searchStatusMessage = message;
    if (!searchStatus) {
      return;
    }
    searchStatus.hidden = !message;
    searchStatus.textContent = message;
  }

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
    state.meta = state.meta || { autoBoxNumbers: true, boxOrderDirection: "top", activeBoxViewId: null, availableCategoryNumbers: [], availableBoxNumbers: [], nextBoxNumber: 1, nextCategoryNumber: 1, universalBoxScaleSourceId: null, contentImageScaleSourceKey: null };
    state.meta.autoBoxNumbers = state.meta.autoBoxNumbers !== false;
    state.meta.boxOrderDirection = state.meta.boxOrderDirection === "bottom" ? "bottom" : "top";
    state.meta.activeBoxViewId = typeof state.meta.activeBoxViewId === "string" ? state.meta.activeBoxViewId : null;
    state.meta.availableCategoryNumbers = Array.isArray(state.meta.availableCategoryNumbers) ? state.meta.availableCategoryNumbers : [];
    state.meta.availableBoxNumbers = Array.isArray(state.meta.availableBoxNumbers) ? state.meta.availableBoxNumbers : [];
    state.meta.universalBoxScaleSourceId = typeof state.meta.universalBoxScaleSourceId === "string" ? state.meta.universalBoxScaleSourceId : null;
    state.meta.contentImageScaleSourceKey = typeof state.meta.contentImageScaleSourceKey === "string" ? state.meta.contentImageScaleSourceKey : null;
    state.categoriesVisible = state.categoriesVisible !== false;

    const boxIds = new Set(state.boxes.map((box) => box.id));
    const categoryIds = new Set(state.categories.map((category) => category.id));
    const usedCategoryNumbers = new Set();
    let inferredNextCategoryNumber = 1;
    const usedBoxNumbers = new Set();
    let inferredNextBoxNumber = 1;

    state.boxes.forEach((box, index) => {
      if (box.categoryId && !categoryIds.has(box.categoryId)) {
        box.categoryId = null;
      }

      box.parentBoxId = typeof box.parentBoxId === "string" && boxIds.has(box.parentBoxId) && box.parentBoxId !== box.id
        ? box.parentBoxId
        : null;

      if (box.parentBoxId) {
        box.categoryId = null;
      }

      const parsedBoxNumber = Number.parseInt(box.numberInput, 10);
      let boxNumber = Number.isInteger(box.number) && box.number > 0 ? box.number : extractBoxNumber(box.name);
      if ((!boxNumber || usedBoxNumbers.has(boxNumber)) && Number.isInteger(parsedBoxNumber) && parsedBoxNumber > 0 && !usedBoxNumbers.has(parsedBoxNumber)) {
        boxNumber = parsedBoxNumber;
      }

      if ((!boxNumber || usedBoxNumbers.has(boxNumber)) && !box.manualNumberEntry) {
        while (usedBoxNumbers.has(inferredNextBoxNumber)) {
          inferredNextBoxNumber += 1;
        }
        boxNumber = inferredNextBoxNumber;
      }

      box.number = Number.isInteger(boxNumber) && boxNumber > 0 ? boxNumber : null;
      box.numberInput = typeof box.numberInput === "string"
        ? box.numberInput
        : (Number.isInteger(box.number) && box.number > 0 ? String(box.number) : "");
      box.numberError = typeof box.numberError === "string" ? box.numberError : "";
      box.manualNumberEntry = Boolean(box.manualNumberEntry || box.parentBoxId);
      box.fragile = Boolean(box.fragile);
      box.heavy = Boolean(box.heavy);
      box.fragileActivatedAt = Number.isFinite(box.fragileActivatedAt) ? box.fragileActivatedAt : (box.fragile ? Date.now() : 0);
      box.heavyActivatedAt = Number.isFinite(box.heavyActivatedAt) ? box.heavyActivatedAt : (box.heavy ? box.fragileActivatedAt + 1 : 0);
      box.itemsText = typeof box.itemsText === "string" ? box.itemsText : "";
      box.itemsCollapsed = Boolean(box.itemsCollapsed);
      box.contentImages = Array.isArray(box.contentImages) ? box.contentImages.filter(Boolean).map((image, imageIndex) => ({
        id: typeof image.id === "string" ? image.id : uid(`content-image-${imageIndex}`),
        blob: image.blob || null,
        type: image.type || "image/jpeg",
        name: image.name || `content-${imageIndex + 1}`,
        updatedAt: image.updatedAt || Date.now(),
        tags: Array.isArray(image.tags) ? image.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
        tagDraft: typeof image.tagDraft === "string" ? image.tagDraft : "",
        tagsCollapsed: Boolean(image.tagsCollapsed),
        viewScale: normalizeBoxScale(image.viewScale),
        scaleSelected: Boolean(image.scaleSelected),
        restoreViewScale: Number.isFinite(Number.parseFloat(image.restoreViewScale)) ? normalizeBoxScale(image.restoreViewScale) : null,
        scaleSourceKey: typeof image.scaleSourceKey === "string" ? image.scaleSourceKey : null
      })).filter((image) => image.blob) : [];
      if (Number.isInteger(box.number) && box.number > 0) {
        usedBoxNumbers.add(box.number);
        inferredNextBoxNumber = Math.max(inferredNextBoxNumber, box.number + 1);
      }
      box.order = Number.isFinite(box.order) ? box.order : (index + 1) * 1000;
      box.name = typeof box.name === "string" ? box.name : "";
      box.viewScale = normalizeBoxScale(box.viewScale);
    });

    if (state.meta.universalBoxScaleSourceId && !findBox(state.meta.universalBoxScaleSourceId)) {
      state.meta.universalBoxScaleSourceId = null;
    }

    if (state.meta.activeBoxViewId && !findBox(state.meta.activeBoxViewId)) {
      state.meta.activeBoxViewId = null;
    }

    const hasContentImageScaleSource = state.boxes.some((box) => box.contentImages?.some((image) => getContentImageScaleKey(box.id, image.id) === state.meta.contentImageScaleSourceKey));
    if (state.meta.contentImageScaleSourceKey && !hasContentImageScaleSource) {
      state.meta.contentImageScaleSourceKey = null;
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
      if (ref.type === "box" && box && !box.categoryId && !box.parentBoxId) {
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

    state.boxes.filter((box) => !box.categoryId && !box.parentBoxId).sort(byOrder).forEach((box) => {
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
    const { compact = false, forceActive = false, extraClass = "", boxOnly = false } = options;
    const key = contextKey(context);
    const active = forceActive || activeLineKey === key;
    const controls = boxOnly
      ? `<div class="insert-actions single">
          <button type="button" data-action="new-box" ${contextAttributes(context)}>New Box</button>
        </div>`
      : state.categoriesVisible
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
        Put boxes into catagory
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

  function markDraggedCategorySourceHidden(categoryId) {
    organizerList.querySelector(`.category-section[data-category-id="${CSS.escape(categoryId)}"]`)?.classList.add("drag-source-hidden");
  }

  function markDraggedBoxSourceHidden(boxId) {
    organizerList.querySelector(`.box-card[data-box-id="${CSS.escape(boxId)}"]`)?.classList.add("drag-source-hidden");
  }

  function markDraggedBoxSourcesHidden(boxIds) {
    boxIds.forEach((boxId) => markDraggedBoxSourceHidden(boxId));
  }

  function getDraggedBoxIds(boxId) {
    if (selectedBoxIds.has(boxId) && selectedBoxIds.size > 1) {
      return [...selectedBoxIds].filter((selectedBoxId) => Boolean(findBox(selectedBoxId)));
    }

    return [boxId];
  }

  function toggleBoxSelection(boxId) {
    if (!findBox(boxId)) {
      return;
    }

    if (selectedBoxIds.has(boxId)) {
      selectedBoxIds.delete(boxId);
    } else {
      selectedBoxIds.add(boxId);
    }
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

  function getContentImageKey(boxId, imageId) {
    return `content:${boxId}:${imageId}`;
  }

  function parseContentImageKey(key) {
    const match = /^content:([^:]+):(.+)$/.exec(String(key || ""));
    return match ? { boxId: match[1], imageId: match[2] } : null;
  }

  function getContentImageSrc(boxId, image) {
    if (!image?.blob) {
      return PLACEHOLDER_IMAGE;
    }

    const key = getContentImageKey(boxId, image.id);
    if (!imageUrls.has(key)) {
      imageUrls.set(key, URL.createObjectURL(image.blob));
    }

    return imageUrls.get(key);
  }

  function revokeContentImages(boxId) {
    [...imageUrls.keys()]
      .filter((key) => key.startsWith(`content:${boxId}:`))
      .forEach((key) => {
        URL.revokeObjectURL(imageUrls.get(key));
        imageUrls.delete(key);
      });
  }

  function findContentImage(boxId, imageId) {
    const box = findBox(boxId);
    if (!box) {
      return null;
    }

    const image = box.contentImages.find((entry) => entry.id === imageId);
    return image ? { box, image } : null;
  }

  function applyContentImageTagInput(boxId, imageId, rawValue) {
    const match = findContentImage(boxId, imageId);
    if (!match) {
      return false;
    }

    const { image } = match;
    const value = String(rawValue || "");
    const segments = value.split(",");
    const completedTags = segments.slice(0, -1).map((segment) => segment.trim()).filter(Boolean);

    if (!completedTags.length) {
      image.tagDraft = value;
      scheduleSave();
      return false;
    }

    image.tags = [...image.tags, ...completedTags];
    image.tagDraft = segments.at(-1)?.trimStart() || "";
    scheduleSave();
    return true;
  }

  function queueSearchJump(jump) {
    pendingSearchJump = jump;
  }

  function getSearchTargetElement(jump) {
    if (!jump) {
      return null;
    }

    if (jump.type === "box-card") {
      return organizerList.querySelector(`.box-card[data-box-id="${CSS.escape(jump.boxId)}"]`);
    }

    if (jump.type === "tag") {
      return organizerList.querySelector(`.box-content-tag[data-box-id="${CSS.escape(jump.boxId)}"][data-image-id="${CSS.escape(jump.imageId)}"][data-tag-value="${CSS.escape(jump.tagValue)}"]`);
    }

    if (jump.type === "items") {
      return organizerList.querySelector(`[data-action="box-items"][data-box-id="${CSS.escape(jump.boxId)}"]`);
    }

    return null;
  }

  function applyPendingSearchJump() {
    if (!pendingSearchJump) {
      return;
    }

    const jump = pendingSearchJump;
    pendingSearchJump = null;

    requestAnimationFrame(() => {
      const target = getSearchTargetElement(jump);
      if (!target) {
        return;
      }

      target.scrollIntoView({ block: "center", behavior: "smooth" });
      if (typeof target.focus === "function" && (target.matches("textarea") || target.matches("input"))) {
        target.focus();
      }
    });
  }

  function navigateToSearchPage(pageBoxId, jump) {
    queueSearchJump(jump);

    if (pageBoxId) {
      openBoxView(pageBoxId);
      return;
    }

    state.meta.activeBoxViewId = null;
    selectedBoxIds.clear();
    clearContentImageSelection();
    scheduleSave();
    renderOrganizer();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function findSearchMatch(query) {
    for (const box of state.boxes) {
      const boxName = (box.name || "").trim().toLowerCase();
      const displayNumber = String(getBoxDisplayNumber(box) || "").toLowerCase();
      const boxLabel = getBoxLabel(box).toLowerCase();

      if ((boxName && boxName.includes(query)) || (displayNumber && displayNumber.includes(query)) || boxLabel.includes(query)) {
        return {
          pageBoxId: box.parentBoxId || null,
          jump: {
            type: "box-card",
            boxId: box.id
          }
        };
      }

      for (const image of box.contentImages) {
        const matchedTag = image.tags.find((tag) => tag.toLowerCase().includes(query));
        if (matchedTag) {
          return {
            pageBoxId: box.id,
            jump: {
              type: "tag",
              boxId: box.id,
              imageId: image.id,
              tagValue: matchedTag
            }
          };
        }
      }

      const hasMatchingItem = box.itemsText
        .split(/\r?\n/)
        .some((line) => line.trim().toLowerCase().includes(query));

      if (hasMatchingItem) {
        return {
          pageBoxId: box.id,
          jump: {
            type: "items",
            boxId: box.id
          }
        };
      }
    }

    return null;
  }

  function clearContentImageSelection() {
    selectedContentImageKeys.clear();
  }

  function toggleContentImageSelection(boxId, imageId) {
    const key = getContentImageKey(boxId, imageId);
    if (selectedContentImageKeys.has(key)) {
      selectedContentImageKeys.delete(key);
    } else {
      selectedContentImageKeys.add(key);
    }
  }

  function removeSelectedContentImages() {
    const groupedImageIds = new Map();

    [...selectedContentImageKeys].forEach((key) => {
      const parsed = parseContentImageKey(key);
      if (!parsed) {
        return;
      }
      const imageIds = groupedImageIds.get(parsed.boxId) || new Set();
      imageIds.add(parsed.imageId);
      groupedImageIds.set(parsed.boxId, imageIds);
    });

    groupedImageIds.forEach((imageIds, boxId) => {
      const box = findBox(boxId);
      if (!box) {
        return;
      }

      box.contentImages = box.contentImages.filter((image) => {
        if (!imageIds.has(image.id)) {
          return true;
        }

        const key = getContentImageKey(boxId, image.id);
        const currentUrl = imageUrls.get(key);
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
          imageUrls.delete(key);
        }
        return false;
      });
    });

    clearContentImageSelection();
  }

  function boxesForCategory(categoryId) {
    return state.boxes.filter((box) => !box.parentBoxId && (box.categoryId || null) === (categoryId || null)).sort(byOrder);
  }

  function getChildBoxes(parentBoxId = null) {
    return state.boxes.filter((box) => (box.parentBoxId || null) === (parentBoxId || null)).sort(byOrder);
  }

  function getDirectionalBoxes(boxes) {
    return state.meta.boxOrderDirection === "bottom" ? [...boxes].reverse() : [...boxes];
  }

  function getOrderedChildBoxes(parentBoxId) {
    return getDirectionalBoxes(getChildBoxes(parentBoxId));
  }

  function getCurrentViewBox() {
    return state.meta.activeBoxViewId ? findBox(state.meta.activeBoxViewId) : null;
  }

  function getBoxDisplayNumber(box) {
    if (!box) {
      return "";
    }

    if (!box.parentBoxId) {
      return Number.isInteger(box.number) && box.number > 0 ? String(box.number) : "";
    }

    const parentBox = findBox(box.parentBoxId);
    const parentNumber = getBoxDisplayNumber(parentBox);
    const siblingIndex = getOrderedChildBoxes(box.parentBoxId).findIndex((childBox) => childBox.id === box.id);
    return siblingIndex >= 0
      ? `${parentNumber || "Box"}.${siblingIndex + 1}`.replace(/^Box\./, "")
      : parentNumber;
  }

  function getBoxLabel(box) {
    const displayNumber = getBoxDisplayNumber(box);
    return displayNumber ? `Box no.${displayNumber}` : (box.name?.trim() || "Box");
  }

  function getBoxBreadcrumbs(boxId) {
    const trail = [];
    let current = findBox(boxId);

    while (current) {
      trail.unshift(current);
      current = current.parentBoxId ? findBox(current.parentBoxId) : null;
    }

    return trail;
  }

  function getRootBoxesInPageOrder() {
    const orderedBoxes = [];
    const seenBoxIds = new Set();

    state.layout.forEach((ref) => {
      if (ref.type === "box") {
        const box = findBox(ref.id);
        if (box && !box.parentBoxId && !seenBoxIds.has(box.id)) {
          orderedBoxes.push(box);
          seenBoxIds.add(box.id);
        }
        return;
      }

      if (ref.type === "category") {
        boxesForCategory(ref.id).forEach((box) => {
          if (!seenBoxIds.has(box.id)) {
            orderedBoxes.push(box);
            seenBoxIds.add(box.id);
          }
        });
      }
    });

    state.boxes
      .filter((box) => !box.parentBoxId && !box.categoryId && !seenBoxIds.has(box.id))
      .sort(byOrder)
      .forEach((box) => orderedBoxes.push(box));

    return getDirectionalBoxes(orderedBoxes);
  }

  function syncAutoBoxNumbersByDirection() {
    if (!state.meta.autoBoxNumbers) {
      return false;
    }

    let changed = false;
    const orderedBoxes = getRootBoxesInPageOrder();

    orderedBoxes.forEach((box, index) => {
      const nextNumber = index + 1;
      if (box.number !== nextNumber || box.numberInput !== String(nextNumber) || box.numberError) {
        box.number = nextNumber;
        box.numberInput = String(nextNumber);
        box.numberError = "";
        changed = true;
      }
    });

    state.meta.availableBoxNumbers = [];
    state.meta.nextBoxNumber = orderedBoxes.length + 1;
    return changed;
  }

  function renderContentImages(box) {
    if (!box.contentImages.length) {
      return `<p class="box-content-empty">No content photos added yet.</p>`;
    }

    return `<div class="box-content-gallery">${box.contentImages.map((image, index) => {
      const imageKey = getContentImageKey(box.id, image.id);
      const selected = selectedContentImageKeys.has(imageKey);
      const tagsHtml = image.tags.map((tag) => `<span class="box-content-tag">${escapeHtml(tag)}</span>`).join("");
      const imageScale = normalizeBoxScale(image.viewScale);
      return `<div class="box-content-card ${selected ? "selected" : ""} ${image.tagsCollapsed ? "collapsed" : ""}" data-box-id="${escapeHtml(box.id)}" data-image-id="${escapeHtml(image.id)}">
        <div class="box-content-photo-column" style="--content-image-scale:${escapeHtml(imageScale.toFixed(2))}">
          <figure class="box-content-photo"><img src="${escapeHtml(getContentImageSrc(box.id, image))}" alt="${escapeHtml(getBoxLabel(box))} content photo" loading="lazy"></figure>
          <div class="box-content-scale-controls">
            <label class="box-scale-toggle box-content-scale-toggle">
              <input type="checkbox" data-action="content-image-scale-select" data-box-id="${escapeHtml(box.id)}" data-image-id="${escapeHtml(image.id)}" data-skip-select="true" aria-label="Apply content image size changes with checked images" ${image.scaleSelected ? "checked" : ""}>
              <span></span>
            </label>
            <label class="box-scale-select-wrap box-content-scale-select-wrap">
              <i class="bi bi-zoom-in"></i>
              <select data-action="content-image-scale" data-box-id="${escapeHtml(box.id)}" data-image-id="${escapeHtml(image.id)}" data-skip-select="true" aria-label="Content image size multiplier">
                ${renderBoxScaleOptions(imageScale)}
              </select>
            </label>
            <span class="box-content-number-badge" aria-label="Image number">#${index + 1}</span>
          </div>
        </div>
        <div class="box-content-tag-editor ${image.tagsCollapsed ? "collapsed" : ""}">
          <button type="button" class="box-content-tag-toggle" data-action="toggle-content-image-tags" data-box-id="${escapeHtml(box.id)}" data-image-id="${escapeHtml(image.id)}" aria-label="${image.tagsCollapsed ? "Expand" : "Collapse"} content photo tags">
            <i class="bi ${image.tagsCollapsed ? "bi-chevron-right" : "bi-chevron-left"}" aria-hidden="true"></i>
          </button>
          <div class="box-content-tag-body ${tagsHtml ? "has-tags" : "no-tags"}">
            ${tagsHtml ? `<div class="box-content-tag-list">${image.tags.map((tag) => `<span class="box-content-tag" data-box-id="${escapeHtml(box.id)}" data-image-id="${escapeHtml(image.id)}" data-tag-value="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
            <textarea class="box-content-tag-input" data-action="content-image-tag-input" data-box-id="${escapeHtml(box.id)}" data-image-id="${escapeHtml(image.id)}" placeholder="Type tags separated by commas" aria-label="Content photo tags for ${escapeHtml(getBoxLabel(box))}">${escapeHtml(image.tagDraft || "")}</textarea>
          </div>
        </div>
      </div>`;
    }).join("")}</div>`;
  }

  function renderBoxView(box) {
    const breadcrumbs = getBoxBreadcrumbs(box.id);
    const childBoxes = getOrderedChildBoxes(box.id);
    const itemsCollapsed = Boolean(box.itemsCollapsed);
    const breadcrumbHtml = breadcrumbs.map((crumb, index) => index === breadcrumbs.length - 1 ? `<span>${escapeHtml(getBoxLabel(crumb))}</span>` : `<button type="button" data-action="open-box" data-box-id="${escapeHtml(crumb.id)}">${escapeHtml(getBoxLabel(crumb))}</button>`).join("<span>/</span>");
    const childInsertContext = { scope: "box-child", parentBoxId: box.id };

    return `<section class="box-view-shell">
      <div class="box-view-content-rail" aria-label="Box content actions">
        <button type="button" class="box-view-content-action" data-action="content-camera" data-box-id="${escapeHtml(box.id)}" aria-label="Take Photo">
          <i class="bi bi-camera-fill" aria-hidden="true"></i>
        </button>
        <button type="button" class="box-view-content-action" data-action="content-gallery" data-box-id="${escapeHtml(box.id)}" aria-label="Upload Photo">
          <i class="bi bi-images" aria-hidden="true"></i>
        </button>
      </div>
      <div class="box-view-header">
        ${box.parentBoxId ? `<button type="button" class="toolbar-action-button box-view-back" data-action="box-view-back">Back</button>` : ""}
        <div class="box-view-heading">
          <div class="box-view-breadcrumbs"><button type="button" data-action="box-view-root">Home</button>${breadcrumbs.length ? `<span>/</span>${breadcrumbHtml}` : ""}</div>
        </div>
      </div>
      <section class="nested-boxes-section">
        <div class="nested-box-list">${renderInsertLine(childInsertContext, { extraClass: "nested-box-insert", boxOnly: true })}${childBoxes.length ? childBoxes.map((childBox) => renderBox(childBox, { scope: "box-child", parentBoxId: box.id, afterType: "box", afterId: childBox.id })).join("") : ""}${renderContentImages(box)}</div>
      </section>
      <section class="box-items-dock ${itemsCollapsed ? "collapsed" : ""}">
        <div id="boxItemsPanel" class="box-items-panel" ${itemsCollapsed ? "hidden" : ""}>
          <textarea id="boxItemsTextarea" data-action="box-items" data-box-id="${escapeHtml(box.id)}" placeholder="Type one item per line">${escapeHtml(box.itemsText || "")}</textarea>
        </div>
        <button type="button" class="box-items-toggle" data-action="toggle-box-items" data-box-id="${escapeHtml(box.id)}" aria-expanded="${itemsCollapsed ? "false" : "true"}" aria-controls="boxItemsPanel">
          <span class="box-items-toggle-copy">
            <span class="box-items-toggle-label">Items in ${escapeHtml(getBoxLabel(box))}</span>
            <span class="box-items-help">Each line is searchable from the search bar at the top.</span>
          </span>
          <i class="bi ${itemsCollapsed ? "bi-chevron-up" : "bi-chevron-down"}" aria-hidden="true"></i>
        </button>
      </section>
    </section>`;
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

  function getBoxesInPageOrder() {
    const orderedBoxes = [];
    const seenBoxIds = new Set();

    state.layout.forEach((ref) => {
      if (ref.type === "box") {
        const box = findBox(ref.id);
        if (box && !seenBoxIds.has(box.id)) {
          orderedBoxes.push(box);
          seenBoxIds.add(box.id);
        }
        return;
      }

      if (ref.type === "category") {
        boxesForCategory(ref.id).forEach((box) => {
          if (!seenBoxIds.has(box.id)) {
            orderedBoxes.push(box);
            seenBoxIds.add(box.id);
          }
        });
      }
    });

    state.boxes
      .filter((box) => !seenBoxIds.has(box.id))
      .sort(byOrder)
      .forEach((box) => orderedBoxes.push(box));

    return state.meta.boxOrderDirection === "bottom" ? [...orderedBoxes].reverse() : orderedBoxes;
  }

  function syncAutoBoxNumbersByDirection() {
    if (!state.meta.autoBoxNumbers) {
      return false;
    }

    let changed = false;
    const orderedBoxes = getBoxesInPageOrder();

    orderedBoxes.forEach((box, index) => {
      const nextNumber = index + 1;
      if (box.number !== nextNumber || box.numberInput !== String(nextNumber) || box.numberError) {
        box.number = nextNumber;
        box.numberInput = String(nextNumber);
        box.numberError = "";
        changed = true;
      }
    });

    state.meta.availableBoxNumbers = [];
    state.meta.nextBoxNumber = orderedBoxes.length + 1;
    return changed;
  }

  function getEffectiveBoxScale(box) {
    const universalSourceBox = getUniversalScaleSourceBox();
    return universalSourceBox ? normalizeBoxScale(universalSourceBox.viewScale) : normalizeBoxScale(box.viewScale);
  }

  function renderBoxScaleOptions(selectedScale) {
    return BOX_SCALE_OPTIONS.map((scale) => `<option value="${scale}" ${scale === selectedScale ? "selected" : ""}>${scale}x</option>`).join("");
  }

  function restoreContentImageScales(sourceKey) {
    state.boxes.forEach((box) => {
      box.contentImages?.forEach((image) => {
        if (image.scaleSourceKey === sourceKey) {
          image.viewScale = normalizeBoxScale(image.restoreViewScale);
          image.restoreViewScale = null;
          image.scaleSourceKey = null;
        }
        if (getContentImageScaleKey(box.id, image.id) === sourceKey) {
          image.scaleSelected = false;
        }
      });
    });
    if (state.meta.contentImageScaleSourceKey === sourceKey) {
      state.meta.contentImageScaleSourceKey = null;
    }
  }

  function applyContentImageScaleSource(boxId, imageId) {
    const sourceKey = getContentImageScaleKey(boxId, imageId);
    const sourceBox = findBox(boxId);
    const sourceImage = sourceBox?.contentImages.find((entry) => entry.id === imageId);
    if (!sourceImage) {
      return;
    }

    if (state.meta.contentImageScaleSourceKey && state.meta.contentImageScaleSourceKey !== sourceKey) {
      restoreContentImageScales(state.meta.contentImageScaleSourceKey);
    }

    const nextScale = normalizeBoxScale(sourceImage.viewScale);
    state.boxes.forEach((box) => {
      box.contentImages?.forEach((image) => {
        const imageKey = getContentImageScaleKey(box.id, image.id);
        image.scaleSelected = imageKey === sourceKey;
        if (imageKey !== sourceKey) {
          image.restoreViewScale = image.viewScale;
          image.scaleSourceKey = sourceKey;
          image.viewScale = nextScale;
        } else {
          image.restoreViewScale = null;
          image.scaleSourceKey = null;
        }
      });
    });
    state.meta.contentImageScaleSourceKey = sourceKey;
  }

  function renderBox(box, context, options = {}) {
    const selected = selectedBoxIds.has(box.id);
    const boxScale = normalizeBoxScale(box.viewScale);
    const effectiveScale = getEffectiveBoxScale(box);
    const isUniversalSource = state.meta.universalBoxScaleSourceId === box.id;
    const universalScaleLocked = Boolean(state.meta.universalBoxScaleSourceId && !isUniversalSource);
    const boxName = typeof box.name === "string" ? box.name : "";
    const displayNumber = getBoxDisplayNumber(box);
    const boxNumberLabel = displayNumber ? `Box ${displayNumber}` : "Box";
    const photoAlt = boxName.trim() || boxNumberLabel;
    const numberValue = typeof box.numberInput === "string" ? box.numberInput : (Number.isInteger(box.number) && box.number > 0 ? String(box.number) : "");
    const numberError = (typeof box.numberError === "string" && box.numberError)
      || (Boolean(box.manualNumberEntry) && (!Number.isInteger(box.number) || box.number <= 0) ? "Enter a valid box number." : "");
    const showManualNumberEntry = Boolean(box.manualNumberEntry);
    const autoNumberWidth = Math.max(5, String(boxNumberLabel || "Box").length + 1);
    const showAvailableNumberChoices = state.meta.autoBoxNumbers === false
      && showManualNumberEntry
      && !String(numberValue).trim()
      && state.meta.availableBoxNumbers.length > 0;
    const orderedBadges = getOrderedImageBadges(box);
    const bottomBadge = orderedBadges[0]?.html || "";
    const topBadge = orderedBadges.length > 1 ? orderedBadges[1].html : "";
    const availableNumberChoices = showAvailableNumberChoices
      ? state.meta.availableBoxNumbers
          .slice(0, 8)
          .map((value) => `<button type="button" class="box-number-choice" data-action="choose-available-box-number" data-box-id="${escapeHtml(box.id)}" data-box-number="${escapeHtml(value)}" data-skip-select="true">${escapeHtml(value)}</button>`)
          .join("")
      : "";

    return `<article class="box-card ${selected ? "selected" : ""} ${isUniversalSource ? "universal-source" : ""}" style="--box-scale:${escapeHtml(effectiveScale.toFixed(2))}" data-box-id="${escapeHtml(box.id)}" data-category-id="${escapeHtml(box.categoryId || "")}">
      <div class="box-image-shell">
        <img src="${escapeHtml(getBoxImageSrc(box))}" alt="${escapeHtml(photoAlt)} photo" loading="lazy">
        ${bottomBadge ? `<div class="box-image-badges box-image-badges-bottom">${bottomBadge}</div>` : ""}
        ${topBadge ? `<div class="box-image-badges box-image-badges-top">${topBadge}</div>` : ""}
        <button type="button" class="icon-button image-action enlarge" data-action="expand-photo" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Enlarge box photo"><i class="bi bi-arrows-angle-expand"></i></button>
        <button type="button" class="icon-button image-action camera" data-action="camera" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Take box photo"><i class="bi bi-camera-fill"></i></button>
        <button type="button" class="icon-button image-action gallery" data-action="gallery" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Choose box photo"><i class="bi bi-images"></i></button>
        <button type="button" class="icon-button image-action clear" data-action="clear-photo" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Clear box photo"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="box-details">
        <input type="text" value="${escapeHtml(boxName)}" data-action="box-name" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" data-autosize-min="96" aria-label="Box name" placeholder="Name this box">
        ${showManualNumberEntry
          ? `<label class="box-number-edit-wrap">
              <span>Box no.</span>
              <div class="box-number-input-shell">
                <input type="number" value="${escapeHtml(numberValue)}" data-action="box-number" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" data-autosize-min="38" aria-label="Box no." min="1" step="1" aria-invalid="${numberError ? "true" : "false"}">
                ${showAvailableNumberChoices ? `<div class="box-number-popup" role="listbox" aria-label="Available box numbers"><p class="box-number-popup-title">Deleted box numbers</p>${availableNumberChoices}</div>` : ""}
              </div>
            </label>
            ${numberError ? `<p class="box-inline-error">${escapeHtml(numberError)}</p>` : ""}`
          : `<span class="box-number-label" style="--box-number-ch:${escapeHtml(String(autoNumberWidth))}">${escapeHtml(boxNumberLabel)}</span>`}
        <div class="box-property-row">
          <label class="box-property-toggle">
            <span class="box-property-toggle-shell">
              <input type="checkbox" data-action="box-fragile" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Mark package as fragile" ${box.fragile ? "checked" : ""}>
              <span class="box-property-toggle-box" aria-hidden="true"><i class="bi bi-check-lg"></i></span>
            </span>
            <span class="box-property-label">Fragile</span>
          </label>
          <label class="box-property-toggle">
            <span class="box-property-toggle-shell">
              <input type="checkbox" data-action="box-heavy" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Mark package as heavy" ${box.heavy ? "checked" : ""}>
              <span class="box-property-toggle-box box-property-toggle-box-heavy" aria-hidden="true"><i class="bi bi-check-lg"></i></span>
            </span>
            <span class="box-property-label">Heavy</span>
          </label>
        </div>
        <div class="box-scale-controls">
          <label class="box-scale-select-wrap">
            <i class="bi bi-zoom-in"></i>
            <select data-action="box-scale" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" aria-label="Box size multiplier" ${universalScaleLocked ? "disabled" : ""}>
              ${renderBoxScaleOptions(boxScale)}
            </select>
          </label>
          <label class="box-scale-toggle">
            <input type="checkbox" data-action="box-scale-universal" data-box-id="${escapeHtml(box.id)}" data-skip-select="true" ${isUniversalSource ? "checked" : ""}>
            <span class="box-scale-toggle-box" aria-hidden="true"><i class="bi bi-check-lg"></i></span>
            <span>All boxes</span>
          </label>
        </div>
      </div>
    </article>
    ${options.hideInsertLine ? "" : renderInsertLine(context, { boxOnly: context?.scope === "box-child" })}`;
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
          <input type="text" class="category-name${duplicateInputClass}" value="${escapeHtml(category.name)}" data-action="category-name" data-category-id="${escapeHtml(category.id)}" data-skip-select="true" data-autosize-min="112" aria-label="Category name">
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
        if (box && !box.parentBoxId) {
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

  function renderRootPathHeader() {
    return `<div class="box-view-header root-view-header">
      <div class="box-view-heading">
        <div class="box-view-breadcrumbs"><span>Home</span></div>
      </div>
    </div>`;
  }

  function renderOrganizer() {
    normalizeState();
    syncAutoBoxNumbersByDirection();
    cleanupDragArtifacts();
    categoryToggle.checked = state.categoriesVisible;
    autoBoxNumberToggle.checked = state.meta.autoBoxNumbers !== false;
    orderDirectionButton?.setAttribute("aria-pressed", state.meta.boxOrderDirection === "bottom" ? "true" : "false");
    if (orderDirectionIcon) {
      orderDirectionIcon.className = `bi ${state.meta.boxOrderDirection === "bottom" ? "bi-arrow-down" : "bi-arrow-up"}`;
    }
    const duplicateCategoryIds = getDuplicateCategoryIds();
    const currentViewBox = getCurrentViewBox();

    workspace?.classList.toggle("box-view-active", Boolean(currentViewBox));

    const boxCount = state.boxes.length;
    const categoryCount = state.categories.length;
    summary.textContent = `${boxCount} ${boxCount === 1 ? "box" : "boxes"} across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}.`;
    setSearchStatus(searchStatusMessage);

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

    const content = currentViewBox
      ? renderBoxView(currentViewBox)
      : state.categoriesVisible
      ? state.layout.map((ref, index) => {
          if (ref.type === "category") {
            const category = findCategory(ref.id);
            return category ? renderCategory(category, { isDuplicate: duplicateCategoryIds.has(category.id) }) : "";
          }

          const box = findBox(ref.id);
          if (!box || box.parentBoxId) {
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
      ? `${currentViewBox ? "" : renderRootPathHeader()}${renderInsertLine({ scope: "root-start" }, { extraClass: "root-leading" })}${content}${renderInsertLine({ scope: "root-end" }, { forceActive: true, extraClass: "root-trailing" })}`
      : `${emptyMessage}${renderEmptyRootInsertLines()}`;
    if (currentViewBox) {
      organizerList.innerHTML = content;
    }
    autosizeOrganizerInputs();
    bulkActions.hidden = currentViewBox
      ? (selectedContentImageKeys.size === 0 && selectedBoxIds.size === 0)
      : selectedBoxIds.size === 0;
    renderCategoryDeleteOverlay();
    applyPendingSearchJump();
    updateLayoutMetrics();
    updateScrollButtons();
  }

  function updateScrollButtons() {
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const scrollHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      root.scrollHeight
    );
    const threshold = 12;
    const canScrollUp = scrollTop > threshold;
    const canScrollDown = scrollTop + viewportHeight < scrollHeight - threshold;

    if (scrollToTopButton) {
      scrollToTopButton.hidden = !canScrollUp;
    }

    if (scrollToBottomButton) {
      scrollToBottomButton.hidden = !canScrollDown;
    }
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

  function peekNextBoxNumber() {
    const availableNumber = state.meta.availableBoxNumbers[0];
    if (Number.isInteger(availableNumber) && availableNumber > 0) {
      return availableNumber;
    }

    return Number.isFinite(state.meta.nextBoxNumber) && state.meta.nextBoxNumber > 0 ? state.meta.nextBoxNumber : 1;
  }

  function focusBoxNumber(boxId) {
    requestAnimationFrame(() => {
      const input = organizerList.querySelector(`[data-action="box-number"][data-box-id="${CSS.escape(boxId)}"]`);
      input?.focus();
      input?.select();
    });
  }

  function updateBoxNumberAvailability(previousNumber, nextNumber) {
    if (Number.isInteger(previousNumber) && previousNumber > 0 && previousNumber !== nextNumber && !boxNumberExists(previousNumber)) {
      state.meta.availableBoxNumbers = [...new Set([
        ...state.meta.availableBoxNumbers,
        previousNumber
      ])].sort((left, right) => left - right);
    }

    state.meta.availableBoxNumbers = state.meta.availableBoxNumbers.filter((value) => value !== nextNumber);
    state.meta.nextBoxNumber = Math.max(
      Number.isFinite(state.meta.nextBoxNumber) ? state.meta.nextBoxNumber : 1,
      nextNumber + 1
    );
  }

  function validateAndCommitBoxNumber(boxId, options = {}) {
    const box = findBox(boxId);
    if (!box) {
      return false;
    }

    const requestedNumber = Number.parseInt(box.numberInput, 10);
    if (!Number.isInteger(requestedNumber) || requestedNumber <= 0) {
      box.numberError = "Enter a valid box number.";
      renderOrganizer();
      if (options.focusOnError !== false) {
        focusBoxNumber(boxId);
      }
      return false;
    }

    if (boxNumberExists(requestedNumber, boxId)) {
      box.numberError = "This number already exists, please use another number";
      renderOrganizer();
      if (options.focusOnError !== false) {
        focusBoxNumber(boxId);
      }
      return false;
    }

    if (box.number === requestedNumber && box.numberInput === String(requestedNumber) && !box.numberError) {
      return true;
    }

    const previousNumber = box.number;
    box.number = requestedNumber;
    box.numberInput = String(requestedNumber);
    box.numberError = "";
    updateBoxNumberAvailability(previousNumber, requestedNumber);
    scheduleSave();
    renderOrganizer();
    return true;
  }

  function applyAvailableBoxNumberChoice(boxId, boxNumber) {
    const box = findBox(boxId);
    if (!box) {
      return;
    }

    box.numberInput = boxNumber || "";
    box.numberError = "";
    validateAndCommitBoxNumber(box.id, { focusOnError: false });
    focusBoxNumber(box.id);
  }

  function openBoxView(boxId) {
    const box = findBox(boxId);
    if (!box) {
      return;
    }

    state.meta.activeBoxViewId = box.id;
    selectedBoxIds.clear();
    clearContentImageSelection();
    scheduleSave();
    renderOrganizer();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeBoxView() {
    state.meta.activeBoxViewId = null;
    clearContentImageSelection();
    scheduleSave();
    renderOrganizer();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openContentCamera(boxId) {
    activeContentBoxId = boxId;
    contentCameraInput.value = "";
    contentCameraInput.click();
  }

  function openContentGallery(boxId) {
    activeContentBoxId = boxId;
    contentGalleryInput.value = "";
    contentGalleryInput.click();
  }

  function applyContentImageToBox(boxId, file) {
    const box = findBox(boxId);
    if (!box || !file) {
      return;
    }

    box.contentImages = [...box.contentImages, {
      id: uid("content-image"),
      blob: file,
      type: file.type,
      name: file.name,
      updatedAt: Date.now(),
      tagsCollapsed: true,
      viewScale: 1,
      scaleSelected: false
    }];
    scheduleSave();
    renderOrganizer();
  }

  function performItemSearch() {
    const rawQuery = itemSearchInput?.value.trim() || "";
    const query = rawQuery.toLowerCase();
    if (!query) {
      setSearchStatus("Enter a tag, box name, box number, or item name to search.");
      return;
    }

    const match = findSearchMatch(query);
    if (!match) {
      setSearchStatus(`No match found for \"${rawQuery}\".`);
      return;
    }

    setSearchStatus("");
    navigateToSearchPage(match.pageBoxId, match.jump);
  }

  function assignNumbersToUnnumberedBoxes() {
    syncAutoBoxNumbersByDirection();
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

  function setBoxDraftError(message = "") {
    if (!boxCreateError) {
      return;
    }

    boxCreateError.hidden = !message;
    boxCreateError.textContent = message;
  }

  function resetPendingBoxDraft() {
    if (pendingBoxDraft?.previewUrl) {
      URL.revokeObjectURL(pendingBoxDraft.previewUrl);
    }

    pendingBoxDraft = null;
  }

  function closeBoxCreateModal() {
    boxCreateModal.hidden = true;
    boxCreateCameraInput.value = "";
    boxCreateGalleryInput.value = "";
    boxCreateNameInput.value = "";
    boxCreateNumberInput.value = "";
    boxCreatePreview.src = PLACEHOLDER_IMAGE;
    setBoxDraftError("");
    resetPendingBoxDraft();
  }

  function updateBoxDraftPreview(file = null) {
    if (!pendingBoxDraft) {
      return;
    }

    if (pendingBoxDraft.previewUrl) {
      URL.revokeObjectURL(pendingBoxDraft.previewUrl);
      pendingBoxDraft.previewUrl = null;
    }

    pendingBoxDraft.file = file || null;
    pendingBoxDraft.previewUrl = file ? URL.createObjectURL(file) : null;
    boxCreatePreview.src = pendingBoxDraft.previewUrl || PLACEHOLDER_IMAGE;
  }

  function openBoxCreateModal(context) {
    pendingBoxDraft = {
      context,
      file: null,
      previewUrl: null
    };

    boxCreateModal.hidden = false;
    boxCreateNameInput.value = "";
    boxCreateNumberInput.value = String(peekNextBoxNumber());
    boxCreatePreview.src = PLACEHOLDER_IMAGE;
    setBoxDraftError("");
    autosizeStaticInputs();
    requestAnimationFrame(() => {
      boxCreateNameInput.focus();
      boxCreateNameInput.select();
    });
  }

  function insertNewBox(insertionContext, box) {
    state.boxes.push(box);

    if (box.parentBoxId) {
      const siblingBoxes = getChildBoxes(box.parentBoxId).filter((childBox) => childBox.id !== box.id);
      const lastSibling = siblingBoxes[siblingBoxes.length - 1];
      box.order = Number.isFinite(lastSibling?.order) ? lastSibling.order + 1000 : 1000;
      selectedBoxIds.clear();
      activeLineKey = "";
      scheduleSave();
      renderOrganizer();
      window.setTimeout(() => {
        renderOrganizer();
        if (box.manualNumberEntry && (!Number.isInteger(box.number) || box.number <= 0)) {
          focusBoxNumber(box.id);
        } else {
          focusBox(box.id);
        }
      }, 0);
      return;
    }

    if (state.categoriesVisible && (insertionContext.scope === "category" || insertionContext.scope === "category-start") && insertionContext.categoryId) {
      box.categoryId = insertionContext.categoryId;
      insertBoxesInCategory([box.id], insertionContext.categoryId, insertionContext.scope === "category" ? insertionContext.afterId : null);
    } else {
      box.categoryId = null;
      const insertIndex = state.categoriesVisible ? getRootInsertIndex(insertionContext) : state.layout.length;
      insertRootRef({ type: "box", id: box.id }, insertIndex);
    }

    selectedBoxIds.clear();
    activeLineKey = "";
    scheduleSave();
    renderOrganizer();
    window.setTimeout(() => {
      activeLineKey = "";
      renderOrganizer();
      if (box.manualNumberEntry && (!Number.isInteger(box.number) || box.number <= 0)) {
        focusBoxNumber(box.id);
      } else {
        focusBox(box.id);
      }
    }, 0);
  }

  function createBoxRecord(insertionContext, boxNumber, options = {}) {
    const id = uid("box");
    const box = {
      id,
      number: Number.isInteger(boxNumber) && boxNumber > 0 ? boxNumber : null,
      numberInput: Number.isInteger(boxNumber) && boxNumber > 0 ? String(boxNumber) : "",
      numberError: "",
      manualNumberEntry: Boolean(options.manualNumberEntry),
      name: typeof options.name === "string" ? options.name : "",
      categoryId: null,
      order: Date.now(),
      createdAt: Date.now(),
      image: options.file ? {
        blob: options.file,
        type: options.file.type,
        name: options.file.name,
        updatedAt: Date.now()
      } : null,
      contentImages: [],
      viewScale: 1,
      fragile: Boolean(options.fragile),
      heavy: Boolean(options.heavy),
      fragileActivatedAt: Boolean(options.fragile) ? Date.now() : 0,
      heavyActivatedAt: Boolean(options.heavy) ? Date.now() : 0,
      parentBoxId: options.parentBoxId || null,
      itemsText: ""
    };

    insertNewBox(insertionContext, box);
  }

  function submitBoxDraft() {
    if (!pendingBoxDraft) {
      return;
    }

    const boxNumber = Number.parseInt(boxCreateNumberInput.value, 10);
    if (!Number.isInteger(boxNumber) || boxNumber <= 0) {
      setBoxDraftError("Enter a valid box number.");
      boxCreateNumberInput.focus();
      boxCreateNumberInput.select();
      return;
    }

    if (boxNumberExists(boxNumber)) {
      setBoxDraftError("This number already exists, please use another number");
      boxCreateNumberInput.focus();
      boxCreateNumberInput.select();
      return;
    }

    const draft = pendingBoxDraft;
    const boxName = boxCreateNameInput.value.trim();

    closeBoxCreateModal();
    createBoxRecord(draft.context, boxNumber, {
      name: boxName,
      file: draft.file
    });
  }

  function addBox(context) {
    const currentViewBox = getCurrentViewBox();
    if (currentViewBox) {
      const childBoxNumber = state.meta.autoBoxNumbers === false ? null : claimNextBoxNumber();
      createBoxRecord(context, childBoxNumber, {
        name: "",
        manualNumberEntry: true,
        parentBoxId: currentViewBox.id
      });
      return;
    }

    const insertionContext = resolveBoxInsertionContext(context);
    if (state.meta.autoBoxNumbers === false) {
      createBoxRecord(insertionContext, null, {
        name: "",
        manualNumberEntry: true
      });
      return;
    }

    const boxNumber = claimNextBoxNumber();
    createBoxRecord(insertionContext, boxNumber, {
      name: "",
      manualNumberEntry: true
    });
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

  function getDescendantBoxIds(boxId) {
    const descendants = [];
    const queue = [boxId];

    while (queue.length) {
      const currentBoxId = queue.shift();
      descendants.push(currentBoxId);
      getChildBoxes(currentBoxId).forEach((childBox) => queue.push(childBox.id));
    }

    return descendants;
  }

  function removeBoxes(boxIds) {
    const allBoxIds = [...new Set(boxIds.flatMap((boxId) => getDescendantBoxIds(boxId)))];
    recycleBoxNumbers(allBoxIds);
    allBoxIds.forEach((boxId) => {
      revokeBoxImage(boxId);
      revokeContentImages(boxId);
    });
    state.boxes = state.boxes.filter((box) => !allBoxIds.includes(box.id));
    if (state.meta.universalBoxScaleSourceId && allBoxIds.includes(state.meta.universalBoxScaleSourceId)) {
      state.meta.universalBoxScaleSourceId = null;
    }
    if (state.meta.activeBoxViewId && allBoxIds.includes(state.meta.activeBoxViewId)) {
      state.meta.activeBoxViewId = null;
    }
    state.layout = state.layout.filter((ref) => !(ref.type === "box" && allBoxIds.includes(ref.id)));
    selectedBoxIds = new Set([...selectedBoxIds].filter((id) => !allBoxIds.includes(id)));
    overlaySelectedIds = new Set([...overlaySelectedIds].filter((id) => !allBoxIds.includes(id)));
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
    const nextMessage = message || "This action will update your organizer.";
    confirmMessage.hidden = nextMessage.trim() === "Are you sure?";
    confirmMessage.textContent = confirmMessage.hidden ? "" : nextMessage;
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

  function startPress(event, type, id, options = {}) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    const immediate = options.immediate === true;

    pressState = {
      type,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: immediate ? null : window.setTimeout(() => beginDrag(event, type, id), LONG_PRESS_MS)
    };

    if (immediate) {
      beginDrag(event, type, id);
    }
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

    const ids = type === "box" ? getDraggedBoxIds(id) : [id];

    cleanupDragArtifacts();
    window.getSelection?.()?.removeAllRanges();
    if (type === "category") {
      collapseCategoriesForDrag();
      renderOrganizer();
      markDraggedCategorySourceHidden(id);
    } else if (type === "box") {
      markDraggedBoxSourcesHidden(ids);
    }
    suppressClick = true;
    root.classList.toggle("category-dragging", type === "category");
    document.body.classList.add("drag-no-select");

    const ghostState = createDragGhost(type, ids, event);
    document.body.appendChild(ghostState.ghost);

    dragState = {
      type,
      ids,
      ghost: ghostState.ghost,
      offsetX: ghostState.offsetX,
      offsetY: ghostState.offsetY,
      lastSwapCategoryId: null,
      lastSwapBoxId: null,
      usedLiveBoxSwap: false,
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

  function createDragGhost(type, ids, event) {
    const id = ids[0];
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

    if (type === "box") {
      const boxCard = organizerList.querySelector(`.box-card[data-box-id="${CSS.escape(id)}"]`);
      if (boxCard) {
        const boxRect = boxCard.getBoundingClientRect();
        const ghost = document.createElement("div");
        ghost.className = "drag-ghost drag-ghost-box";
        ghost.innerHTML = `<span class="drag-ghost-box-icon" aria-hidden="true"><i class="bi bi-box-seam"></i><span class="drag-ghost-box-count">${ids.length}</span></span>`;

        return {
          ghost,
          offsetX: 24,
          offsetY: 24
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

    if (dragState.type === "category") {
      handleCategoryDragOverlap();
      return;
    }

    if (dragState.type === "box") {
      handleBoxDragMotion(x, y);
      return;
    }

    const target = getDropTargetFromPoint(x, y);

    dragState.dropLine = target.line;
    dragState.dropContext = target.context;

    if (target.line) {
      target.line.classList.add("drop-target");
    }
  }

  function handleCategoryDragOverlap() {
    if (!dragState || dragState.type !== "category") {
      return;
    }

    const draggedCategoryId = dragState.ids[0];
    const ghostRect = dragState.ghost.getBoundingClientRect();
    const bestTarget = [...organizerList.querySelectorAll(".category-section")]
      .filter((section) => section.dataset.categoryId !== draggedCategoryId)
      .map((section) => {
        const rect = section.getBoundingClientRect();
        const overlapWidth = Math.max(0, Math.min(ghostRect.right, rect.right) - Math.max(ghostRect.left, rect.left));
        const overlapHeight = Math.max(0, Math.min(ghostRect.bottom, rect.bottom) - Math.max(ghostRect.top, rect.top));
        return {
          categoryId: section.dataset.categoryId,
          overlapArea: overlapWidth * overlapHeight
        };
      })
      .filter((entry) => entry.overlapArea > 0)
      .sort((left, right) => right.overlapArea - left.overlapArea)[0] || null;

    if (!bestTarget) {
      dragState.lastSwapCategoryId = null;
      return;
    }

    if (dragState.lastSwapCategoryId === bestTarget.categoryId) {
      return;
    }

    swapCategoryPositions(draggedCategoryId, bestTarget.categoryId);
    dragState.lastSwapCategoryId = bestTarget.categoryId;
    swapCategorySectionsInDom(draggedCategoryId, bestTarget.categoryId);
  }

  function findBoxTargetFromPoint(x, y, draggedIds) {
    return document.elementsFromPoint(x, y)
      .find((element) => element.classList?.contains("box-card")
        && !element.classList.contains("drag-source-hidden")
        && !draggedIds.includes(element.dataset.boxId)) || null;
  }

  function handleBoxDragMotion(x, y) {
    if (!dragState || dragState.type !== "box") {
      return;
    }

    if (dragState.ids.length > 1) {
      dragState.lastSwapBoxId = null;
      const target = getDropTargetFromPoint(x, y);
      dragState.dropLine = target.line;
      dragState.dropContext = target.context;
      if (target.line) {
        target.line.classList.add("drop-target");
      }
      return;
    }

    const draggedBoxId = dragState.ids[0];
    const targetCard = findBoxTargetFromPoint(x, y, dragState.ids);

    if (!targetCard) {
      dragState.lastSwapBoxId = null;
      const target = getDropTargetFromPoint(x, y);
      dragState.dropLine = target.line;
      dragState.dropContext = target.context;
      if (target.line) {
        target.line.classList.add("drop-target");
      }
      return;
    }

    dragState.dropLine = null;
    dragState.dropContext = null;

    if (dragState.lastSwapBoxId === targetCard.dataset.boxId) {
      return;
    }

    swapBoxPositions(draggedBoxId, targetCard.dataset.boxId);
    dragState.lastSwapBoxId = targetCard.dataset.boxId;
    dragState.usedLiveBoxSwap = true;
    swapBoxCardsInDom(draggedBoxId, targetCard.dataset.boxId);
  }

  function swapCategoryPositions(draggedCategoryId, targetCategoryId) {
    const draggedIndex = state.layout.findIndex((ref) => ref.type === "category" && ref.id === draggedCategoryId);
    const targetIndex = state.layout.findIndex((ref) => ref.type === "category" && ref.id === targetCategoryId);

    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
      return;
    }

    [state.layout[draggedIndex], state.layout[targetIndex]] = [state.layout[targetIndex], state.layout[draggedIndex]];
    reindexRootLayout();
  }

  function swapCategorySectionsInDom(draggedCategoryId, targetCategoryId) {
    const draggedSection = organizerList.querySelector(`.category-section[data-category-id="${CSS.escape(draggedCategoryId)}"]`);
    const targetSection = organizerList.querySelector(`.category-section[data-category-id="${CSS.escape(targetCategoryId)}"]`);

    if (!draggedSection || !targetSection || draggedSection === targetSection) {
      return;
    }

    const parent = draggedSection.parentNode;
    if (!parent || parent !== targetSection.parentNode) {
      return;
    }

    const firstRects = new Map([
      [draggedSection, draggedSection.getBoundingClientRect()],
      [targetSection, targetSection.getBoundingClientRect()]
    ]);

    const draggedPlaceholder = document.createElement("div");
    const targetPlaceholder = document.createElement("div");

    parent.replaceChild(draggedPlaceholder, draggedSection);
    parent.replaceChild(targetPlaceholder, targetSection);
    parent.replaceChild(draggedSection, targetPlaceholder);
    parent.replaceChild(targetSection, draggedPlaceholder);

    animateCategorySwapMotion(firstRects);
  }

  function animateCategorySwapMotion(firstRects) {
    firstRects.forEach((firstRect, section) => {
      const lastRect = section.getBoundingClientRect();
      const deltaX = firstRect.left - lastRect.left;
      const deltaY = firstRect.top - lastRect.top;

      if (!deltaX && !deltaY) {
        return;
      }

      section.style.transition = "none";
      section.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

      window.requestAnimationFrame(() => {
        section.style.transition = "transform 180ms ease";
        section.style.transform = "translate(0, 0)";

        const cleanup = () => {
          section.style.transition = "";
          section.style.transform = "";
          section.removeEventListener("transitionend", cleanup);
        };

        section.addEventListener("transitionend", cleanup);
        window.setTimeout(cleanup, 220);
      });
    });
  }

  function swapBoxPositions(draggedBoxId, targetBoxId) {
    const draggedBox = findBox(draggedBoxId);
    const targetBox = findBox(targetBoxId);

    if (!draggedBox || !targetBox || draggedBoxId === targetBoxId) {
      return;
    }

    const draggedCategoryId = draggedBox.categoryId || null;
    const targetCategoryId = targetBox.categoryId || null;

    if (draggedCategoryId === null && targetCategoryId === null) {
      const draggedIndex = state.layout.findIndex((ref) => ref.type === "box" && ref.id === draggedBoxId);
      const targetIndex = state.layout.findIndex((ref) => ref.type === "box" && ref.id === targetBoxId);
      if (draggedIndex < 0 || targetIndex < 0) {
        return;
      }
      [state.layout[draggedIndex], state.layout[targetIndex]] = [state.layout[targetIndex], state.layout[draggedIndex]];
      reindexRootLayout();
      return;
    }

    if (draggedCategoryId === targetCategoryId) {
      const draggedOrder = draggedBox.order;
      draggedBox.order = targetBox.order;
      targetBox.order = draggedOrder;
      reindexAllBoxOrders();
      return;
    }

    if (draggedCategoryId === null || targetCategoryId === null) {
      const rootBoxId = draggedCategoryId === null ? draggedBoxId : targetBoxId;
      const categoryBoxId = draggedCategoryId === null ? targetBoxId : draggedBoxId;
      const categoryId = draggedCategoryId === null ? targetCategoryId : draggedCategoryId;
      const rootIndex = state.layout.findIndex((ref) => ref.type === "box" && ref.id === rootBoxId);
      if (rootIndex < 0 || !categoryId) {
        return;
      }

      const categoryOrder = boxesForCategory(categoryId).map((box) => box.id);
      const categoryIndex = categoryOrder.indexOf(categoryBoxId);
      if (categoryIndex < 0) {
        return;
      }

      state.layout[rootIndex] = { type: "box", id: categoryBoxId };

      const reorderedCategoryIds = [...categoryOrder];
      reorderedCategoryIds[categoryIndex] = rootBoxId;

      const rootBox = findBox(rootBoxId);
      const categoryBox = findBox(categoryBoxId);
      if (!rootBox || !categoryBox) {
        return;
      }

      rootBox.categoryId = categoryId;
      categoryBox.categoryId = null;

      reorderedCategoryIds.forEach((boxId, index) => {
        const box = findBox(boxId);
        if (box) {
          box.categoryId = categoryId;
          box.order = (index + 1) * 1000;
        }
      });

      reindexRootLayout();
      return;
    }

    const draggedCategoryIds = boxesForCategory(draggedCategoryId).map((box) => box.id);
    const targetCategoryIds = boxesForCategory(targetCategoryId).map((box) => box.id);
    const draggedIndex = draggedCategoryIds.indexOf(draggedBoxId);
    const targetIndex = targetCategoryIds.indexOf(targetBoxId);

    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    draggedCategoryIds[draggedIndex] = targetBoxId;
    targetCategoryIds[targetIndex] = draggedBoxId;

    draggedBox.categoryId = targetCategoryId;
    targetBox.categoryId = draggedCategoryId;

    draggedCategoryIds.forEach((boxId, index) => {
      const box = findBox(boxId);
      if (box) {
        box.categoryId = draggedCategoryId;
        box.order = (index + 1) * 1000;
      }
    });

    targetCategoryIds.forEach((boxId, index) => {
      const box = findBox(boxId);
      if (box) {
        box.categoryId = targetCategoryId;
        box.order = (index + 1) * 1000;
      }
    });
  }

  function swapBoxCardsInDom(draggedBoxId, targetBoxId) {
    const draggedCard = organizerList.querySelector(`.box-card[data-box-id="${CSS.escape(draggedBoxId)}"]`);
    const targetCard = organizerList.querySelector(`.box-card[data-box-id="${CSS.escape(targetBoxId)}"]`);

    if (!draggedCard || !targetCard || draggedCard === targetCard) {
      return;
    }

    const draggedParent = draggedCard.parentNode;
    const targetParent = targetCard.parentNode;
    if (!draggedParent || !targetParent) {
      return;
    }

    const firstRects = new Map([
      [draggedCard, draggedCard.getBoundingClientRect()],
      [targetCard, targetCard.getBoundingClientRect()]
    ]);

    const draggedPlaceholder = document.createElement("div");
    const targetPlaceholder = document.createElement("div");

    draggedParent.replaceChild(draggedPlaceholder, draggedCard);
    targetParent.replaceChild(targetPlaceholder, targetCard);
    draggedParent.replaceChild(targetCard, draggedPlaceholder);
    targetParent.replaceChild(draggedCard, targetPlaceholder);

    animateCategorySwapMotion(firstRects);
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

    if (currentDrag.type === "category") {
      restoreCategoriesAfterDrag();
      scheduleSave();
      renderOrganizer();
      return;
    }

    if (currentDrag.type === "box") {
      if (currentDrag.usedLiveBoxSwap || !context) {
        selectedBoxIds.clear();
        scheduleSave();
        renderOrganizer();
        return;
      }

      moveSelectedBoxesToContext(currentDrag.ids, context);
      selectedBoxIds.clear();
      scheduleSave();
      renderOrganizer();
      return;
    }

    if (!context) {
      selectedBoxIds.clear();
      renderOrganizer();
      return;
    }

    moveSelectedBoxesToContext(currentDrag.ids, context);
    selectedBoxIds.clear();
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

    if (["toggle-line", "new-category", "new-box", "new-box-inside", "open-box", "box-view-back", "box-view-root", "categorize-root-segment", "expand-photo", "camera", "gallery", "content-camera", "content-gallery", "clear-photo", "draft-camera", "draft-gallery", "draft-clear-photo", "create-box-draft", "cancel-box-draft", "choose-available-box-number", "toggle-category", "toggle-content-image-tags", "toggle-box-items", "delete-category", "bulk-delete", "clear-selection", "close-category-delete", "close-lightbox", "overlay-select-all", "overlay-delete-selected", "overlay-toggle-box", "overlay-move-to"].includes(action)) {
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

    if (action === "new-box-inside") {
      addBox({ scope: "box-child", parentBoxId: actionElement.dataset.boxId });
      return;
    }

    if (action === "open-box") {
      openBoxView(actionElement.dataset.boxId);
      return;
    }

    if (action === "box-view-back") {
      const currentViewBox = getCurrentViewBox();
      if (!currentViewBox?.parentBoxId) {
        closeBoxView();
      } else {
        openBoxView(currentViewBox.parentBoxId);
      }
      return;
    }

    if (action === "box-view-root") {
      closeBoxView();
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

    if (action === "content-camera") {
      openContentCamera(actionElement.dataset.boxId);
      return;
    }

    if (action === "content-gallery") {
      openContentGallery(actionElement.dataset.boxId);
      return;
    }

    if (action === "toggle-box-items") {
      const box = findBox(actionElement.dataset.boxId);
      if (box) {
        box.itemsCollapsed = !box.itemsCollapsed;
        scheduleSave();
        renderOrganizer();
      }
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

    if (action === "toggle-content-image-tags") {
      const match = findContentImage(actionElement.dataset.boxId, actionElement.dataset.imageId);
      if (match) {
        match.image.tagsCollapsed = !match.image.tagsCollapsed;
        scheduleSave();
        renderOrganizer();
      }
      return;
    }

    if (action === "draft-camera") {
      boxCreateCameraInput.value = "";
      boxCreateCameraInput.click();
      return;
    }

    if (action === "draft-gallery") {
      boxCreateGalleryInput.value = "";
      boxCreateGalleryInput.click();
      return;
    }

    if (action === "draft-clear-photo") {
      updateBoxDraftPreview(null);
      return;
    }

    if (action === "cancel-box-draft") {
      closeBoxCreateModal();
      return;
    }

    if (action === "create-box-draft") {
      submitBoxDraft();
      return;
    }

    if (action === "choose-available-box-number") {
      applyAvailableBoxNumberChoice(actionElement.dataset.boxId, actionElement.dataset.boxNumber);
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
        if (!confirmed) {
          return;
        }

        if (getCurrentViewBox() && selectedBoxIds.size > 0) {
          removeBoxes([...selectedBoxIds]);
          selectedBoxIds.clear();
        } else if (getCurrentViewBox() && selectedContentImageKeys.size > 0) {
          removeSelectedContentImages();
        } else {
          removeBoxes([...selectedBoxIds]);
          selectedBoxIds.clear();
        }

        scheduleSave();
        renderOrganizer();
      });
      return;
    }

    if (action === "clear-selection") {
      if (getCurrentViewBox()) {
        selectedBoxIds.clear();
        clearContentImageSelection();
      } else {
        selectedBoxIds.clear();
      }
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

      if (event.target.closest("[data-action='choose-available-box-number']")) {
        return;
      }

      const contentImageCard = event.target.closest(".box-content-card");
      if (contentImageCard && !event.target.closest("button, input, label, select, textarea")) {
        selectedBoxIds.clear();
        toggleContentImageSelection(contentImageCard.dataset.boxId, contentImageCard.dataset.imageId);
        renderOrganizer();
        return;
      }

      const boxCard = event.target.closest(".box-card");
      if (boxCard) {
        const clickedImageShell = event.target.closest(".box-image-shell");
        if (clickedImageShell && !event.target.closest("[data-skip-select], button, input, label, select, textarea")) {
          openBoxView(boxCard.dataset.boxId);
          return;
        }

        const clickedBoxDetails = event.target.closest(".box-details");
        if (clickedBoxDetails && !event.target.closest("[data-skip-select], button, input, label, select, textarea")) {
          clearContentImageSelection();
          toggleBoxSelection(boxCard.dataset.boxId);
          renderOrganizer();
          return;
        }
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
        autosizeInput(target);
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.name = target.value;
          scheduleSave();
          summary.textContent = "Saving box...";
        }
      }

      if (target.dataset.action === "box-items") {
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.itemsText = target.value;
          scheduleSave();
        }
      }

      if (target.dataset.action === "content-image-tag-input") {
        const tagsCommitted = applyContentImageTagInput(target.dataset.boxId, target.dataset.imageId, target.value);
        if (tagsCommitted) {
          const boxId = target.dataset.boxId;
          const imageId = target.dataset.imageId;
          renderOrganizer();
          requestAnimationFrame(() => {
            const nextInput = root.querySelector(`[data-action="content-image-tag-input"][data-box-id="${CSS.escape(boxId)}"][data-image-id="${CSS.escape(imageId)}"]`);
            nextInput?.focus();
            const length = nextInput?.value.length || 0;
            nextInput?.setSelectionRange(length, length);
          });
        }
      }

      if (target.dataset.action === "box-number") {
        autosizeInput(target);
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.numberInput = target.value;
          box.numberError = "";
        }
      }

      if (target === itemSearchInput || target === boxCreateNameInput || target === boxCreateNumberInput) {
        autosizeInput(target);
      }

      if (target.dataset.action === "box-scale") {
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.viewScale = normalizeBoxScale(target.value);
          scheduleSave();
          renderOrganizer();
        }
      }

      if (target.dataset.action === "content-image-scale") {
        const box = findBox(target.dataset.boxId);
        const image = box?.contentImages.find((entry) => entry.id === target.dataset.imageId);
        if (image) {
          const nextScale = normalizeBoxScale(target.value);
          if (image.scaleSelected && state.meta.contentImageScaleSourceKey === getContentImageScaleKey(target.dataset.boxId, target.dataset.imageId)) {
            state.boxes.forEach((entryBox) => {
              entryBox.contentImages?.forEach((entryImage) => {
                entryImage.viewScale = nextScale;
              });
            });
          } else {
            image.viewScale = nextScale;
          }
          scheduleSave();
          renderOrganizer();
        }
      }

      if (target === boxCreateNumberInput) {
        setBoxDraftError("");
      }
    });

    root.addEventListener("change", (event) => {
      const target = event.target;

      if (target.dataset.action === "box-number") {
        validateAndCommitBoxNumber(target.dataset.boxId);
        return;
      }

      if (target.dataset.action === "box-fragile") {
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.fragile = target.checked;
          box.fragileActivatedAt = target.checked ? Date.now() : 0;
          scheduleSave();
          renderOrganizer();
        }
        return;
      }

      if (target.dataset.action === "box-heavy") {
        const box = findBox(target.dataset.boxId);
        if (box) {
          box.heavy = target.checked;
          box.heavyActivatedAt = target.checked ? Date.now() : 0;
          scheduleSave();
          renderOrganizer();
        }
        return;
      }

      if (target.dataset.action === "box-scale-universal") {
        const boxId = target.dataset.boxId;
        state.meta.universalBoxScaleSourceId = target.checked ? boxId : (state.meta.universalBoxScaleSourceId === boxId ? null : state.meta.universalBoxScaleSourceId);
        scheduleSave();
        renderOrganizer();
        return;
      }

      if (target.dataset.action === "content-image-scale-select") {
        const box = findBox(target.dataset.boxId);
        const image = box?.contentImages.find((entry) => entry.id === target.dataset.imageId);
        if (image) {
          if (target.checked) {
            applyContentImageScaleSource(target.dataset.boxId, target.dataset.imageId);
          } else if (state.meta.contentImageScaleSourceKey === getContentImageScaleKey(target.dataset.boxId, target.dataset.imageId)) {
            restoreContentImageScales(state.meta.contentImageScaleSourceKey);
          } else {
            image.scaleSelected = false;
          }
          scheduleSave();
          renderOrganizer();
        }
      }
    });

    root.addEventListener("keydown", (event) => {
      const target = event.target;
      if (event.key !== "Enter") {
        return;
      }

      if (target.dataset.action === "box-number") {
        event.preventDefault();
        event.stopPropagation();
        validateAndCommitBoxNumber(target.dataset.boxId);
        return;
      }

      if (target.dataset.action === "category-name" || target.dataset.action === "box-name") {
        event.preventDefault();
        event.stopPropagation();
        target.blur();
      }
    });

    root.addEventListener("focusout", (event) => {
      const target = event.target;
      if (target.dataset.action === "box-number") {
        if (event.relatedTarget?.closest?.("[data-action='choose-available-box-number']")) {
          return;
        }
        validateAndCommitBoxNumber(target.dataset.boxId);
      }
    });

    root.addEventListener("pointerdown", (event) => {
      const availableNumberChoice = event.target.closest("[data-action='choose-available-box-number']");
      if (availableNumberChoice) {
        event.preventDefault();
        event.stopPropagation();
        applyAvailableBoxNumberChoice(availableNumberChoice.dataset.boxId, availableNumberChoice.dataset.boxNumber);
        return;
      }

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
        startPress(event, "category", categoryDragHandle.dataset.categoryId, { immediate: true });
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
      if (boxCard && !getCurrentViewBox()) {
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

    autoBoxNumberToggle.addEventListener("change", () => {
      state.meta.autoBoxNumbers = autoBoxNumberToggle.checked;
      if (state.meta.autoBoxNumbers) {
        syncAutoBoxNumbersByDirection();
      }
      scheduleSave();
      renderOrganizer();
    });

    orderDirectionButton?.addEventListener("click", () => {
      state.meta.boxOrderDirection = state.meta.boxOrderDirection === "bottom" ? "top" : "bottom";
      if (state.meta.autoBoxNumbers) {
        syncAutoBoxNumbersByDirection();
      }
      scheduleSave();
      renderOrganizer();
    });

    itemSearchButton?.addEventListener("click", performItemSearch);

    itemSearchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        performItemSearch();
      }
    });

    themeToggleButton?.addEventListener("click", () => {
      const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      setTheme(nextTheme);
      persistThemePreference(nextTheme);
    });

    scrollToTopButton?.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    scrollToBottomButton?.addEventListener("click", () => {
      const scrollHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        root.scrollHeight
      );
      window.scrollTo({ top: scrollHeight, behavior: "smooth" });
    });

    window.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", () => {
      autosizeManagedInputs();
      updateLayoutMetrics();
      updateScrollButtons();
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

    contentCameraInput.addEventListener("change", () => {
      const file = contentCameraInput.files?.[0];
      if (file && activeContentBoxId) {
        applyContentImageToBox(activeContentBoxId, file);
      }
    });

    contentGalleryInput.addEventListener("change", () => {
      const file = contentGalleryInput.files?.[0];
      if (file && activeContentBoxId) {
        applyContentImageToBox(activeContentBoxId, file);
      }
    });

    boxCreateCameraInput.addEventListener("change", () => {
      const file = boxCreateCameraInput.files?.[0];
      if (file) {
        updateBoxDraftPreview(file);
      }
    });

    boxCreateGalleryInput.addEventListener("change", () => {
      const file = boxCreateGalleryInput.files?.[0];
      if (file) {
        updateBoxDraftPreview(file);
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

    boxCreateModal.addEventListener("click", (event) => {
      if (event.target === boxCreateModal) {
        closeBoxCreateModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !lightboxModal.hidden) {
        closeImageLightbox();
        return;
      }

      if (event.key === "Escape" && !boxCreateModal.hidden) {
        closeBoxCreateModal();
        return;
      }

      if (event.key === "Enter" && !boxCreateModal.hidden && event.target === boxCreateNumberInput) {
        submitBoxDraft();
      }
    });
  }

  async function init() {
    db = await openDb();
    state = await readStoredState() || emptyState();
    normalizeState();
    bindEvents();
    setTheme(loadThemePreference());
    updateLayoutMetrics();
    renderOrganizer();
    autosizeStaticInputs();
    updateScrollButtons();
  }

  init().catch((error) => {
    console.error("MoveOptimize failed to start", error);
    organizerList.innerHTML = `<div class="empty-state"><strong>MoveOptimize could not start.</strong></div>`;
  });
})();
