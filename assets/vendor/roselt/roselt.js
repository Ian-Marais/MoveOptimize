"use strict";
(() => {
  // src/utils/resolve-url.js
  function resolveUrl(resourcePath, baseUrl = document.baseURI) {
    return new URL(resourcePath, baseUrl).href;
  }
  function normalizeDirectoryPathname(pathname) {
    if (!pathname) {
      return "/";
    }
    return pathname.endsWith("/") ? pathname : pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";
  }
  function createDocumentRelativeSpecifier(targetUrl, documentUrl = document.baseURI) {
    const documentLocation = new URL(documentUrl, document.baseURI);
    const fromSegments = normalizeDirectoryPathname(documentLocation.pathname).split("/").filter(Boolean);
    const toSegments = targetUrl.pathname.split("/").filter(Boolean);
    let sharedSegmentCount = 0;
    while (sharedSegmentCount < fromSegments.length && sharedSegmentCount < toSegments.length && fromSegments[sharedSegmentCount] === toSegments[sharedSegmentCount]) {
      sharedSegmentCount += 1;
    }
    const upSegments = new Array(fromSegments.length - sharedSegmentCount).fill("..");
    const downSegments = toSegments.slice(sharedSegmentCount);
    const relativePath = [...upSegments, ...downSegments].join("/") || ".";
    const prefixedPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return `${prefixedPath}${targetUrl.search}${targetUrl.hash}`;
  }
  function resolveBrowserLoadUrl(resourcePath, baseUrl = document.baseURI) {
    const resolvedUrl = new URL(resourcePath, baseUrl);
    const documentUrl = new URL(document.baseURI);
    if (documentUrl.protocol === "file:" && resolvedUrl.protocol === "file:") {
      return createDocumentRelativeSpecifier(resolvedUrl, documentUrl.href);
    }
    return resolvedUrl.href;
  }
  function deriveBasePath(baseUrl = document.baseURI) {
    const url = new URL(baseUrl, document.baseURI);
    const pathname = url.pathname;
    if (pathname.endsWith("/")) {
      return stripTrailingSlash(pathname);
    }
    const segments = pathname.split("/");
    segments.pop();
    const directory = segments.join("/") || "/";
    return stripTrailingSlash(directory);
  }
  function stripTrailingSlash(value) {
    if (!value || value === "/") {
      return "/";
    }
    return value.endsWith("/") ? value.slice(0, -1) : value;
  }
  function normalizePathname(pathname) {
    if (!pathname) {
      return "/";
    }
    const value = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
  }
  function joinUrlPath(basePath, pathname) {
    const normalizedBase = stripTrailingSlash(basePath || "/");
    const normalizedPath = normalizePathname(pathname);
    if (normalizedBase === "/") {
      return normalizedPath;
    }
    return normalizedPath === "/" ? normalizedBase : `${normalizedBase}${normalizedPath}`;
  }
  function stripBasePath(pathname, basePath) {
    const normalizedPath = normalizePathname(pathname);
    const normalizedBase = stripTrailingSlash(basePath || "/");
    if (normalizedBase === "/") {
      return normalizedPath;
    }
    if (normalizedPath === normalizedBase) {
      return "/";
    }
    if (normalizedPath.startsWith(`${normalizedBase}/`)) {
      return normalizedPath.slice(normalizedBase.length) || "/";
    }
    return normalizedPath;
  }

  // src/runtime/classic-script-loader.js
  var sourceCache = /* @__PURE__ */ new Map();
  var executionCache = /* @__PURE__ */ new Map();
  function isMissingScriptError(error) {
    const message = String(error);
    return error instanceof TypeError || message.includes("Failed to fetch") || message.includes("NetworkError");
  }
  function sourceUsesModuleSyntax(source) {
    return /^\s*(import|export)\b/m.test(source);
  }
  async function readClassicScriptSource(url, { optional = false } = {}) {
    if (!sourceCache.has(url)) {
      sourceCache.set(
        url,
        fetch(resolveBrowserLoadUrl(url)).then(async (response) => {
          if (!response.ok) {
            if (optional) {
              return null;
            }
            throw new Error(`Failed to load script: ${url}`);
          }
          return response.text();
        }).catch((error) => {
          if (optional && isMissingScriptError(error)) {
            return null;
          }
          throw error;
        })
      );
    }
    return sourceCache.get(url);
  }
  function executeClassicScript(source, url) {
    const script = document.createElement("script");
    script.textContent = `(function () {
${source}
}).call(globalThis);
//# sourceURL=${url}`;
    document.head.append(script);
    script.remove();
  }
  async function loadClassicScript(url, { optional = false } = {}) {
    const cacheKey = `${optional ? "optional" : "required"}:${url}`;
    if (!executionCache.has(cacheKey)) {
      executionCache.set(
        cacheKey,
        (async () => {
          const source = await readClassicScriptSource(url, { optional });
          if (source === null) {
            return null;
          }
          if (sourceUsesModuleSyntax(source)) {
            throw new Error(
              `Roselt.js no longer supports ES module page or component scripts. Convert ${url} to a classic script.`
            );
          }
          executeClassicScript(source, url);
          return source;
        })()
      );
    }
    return executionCache.get(cacheKey);
  }

  // src/components/component-registry.js
  function isCustomElementConstructor(value) {
    return typeof value === "function" && value.prototype instanceof HTMLElement;
  }
  var ComponentRegistry = class {
    constructor() {
      this.definitions = /* @__PURE__ */ new Map();
      this.inFlight = /* @__PURE__ */ new Map();
    }
    register(tagName, definition) {
      if (!tagName.includes("-")) {
        throw new Error(`Custom element names must include a hyphen: ${tagName}`);
      }
      this.definitions.set(tagName, definition);
      if (isCustomElementConstructor(definition) && !customElements.get(tagName)) {
        customElements.define(tagName, definition);
      }
    }
    registerAll(definitions2 = {}) {
      for (const [tagName, definition] of Object.entries(definitions2)) {
        this.register(tagName, definition);
      }
    }
    async ensureForRoot(root, fallbackResolver) {
      const tags = /* @__PURE__ */ new Set();
      if (root instanceof Element && root.localName.includes("-")) {
        tags.add(root.localName);
      }
      for (const element of root.querySelectorAll("*")) {
        if (element.localName.includes("-") && !customElements.get(element.localName)) {
          tags.add(element.localName);
        }
      }
      await Promise.all(Array.from(tags, (tagName) => this.load(tagName, fallbackResolver)));
    }
    async load(tagName, fallbackResolver) {
      if (customElements.get(tagName)) {
        return customElements.get(tagName);
      }
      if (!this.inFlight.has(tagName)) {
        this.inFlight.set(tagName, this.resolveDefinition(tagName, fallbackResolver));
      }
      return this.inFlight.get(tagName);
    }
    async resolveDefinition(tagName, fallbackResolver) {
      let definition = this.definitions.get(tagName);
      if (!definition && typeof fallbackResolver === "function") {
        definition = await fallbackResolver(tagName);
        if (definition) {
          this.definitions.set(tagName, definition);
        }
      }
      if (!definition) {
        return null;
      }
      let constructor = definition;
      if (typeof definition === "string") {
        const scriptUrl = resolveUrl(definition);
        const loadedSource = await loadClassicScript(scriptUrl, { optional: true });
        if (loadedSource === null) {
          return null;
        }
        constructor = this.definitions.get(tagName);
        if (!isCustomElementConstructor(constructor)) {
          constructor = customElements.get(tagName) ?? constructor;
        }
      } else if (!isCustomElementConstructor(definition) && typeof definition === "function") {
        const resolved = await definition();
        if (typeof resolved === "string") {
          this.definitions.set(tagName, resolved);
          return this.resolveDefinition(tagName, fallbackResolver);
        }
        constructor = resolved?.default ?? resolved;
      }
      if (!isCustomElementConstructor(constructor)) {
        throw new Error(
          `Component ${tagName} must register itself with Roselt.defineComponent(...) or customElements.define(...).`
        );
      }
      if (!customElements.get(tagName)) {
        customElements.define(tagName, constructor);
      }
      return constructor;
    }
  };
  var globalComponentRegistry = new ComponentRegistry();
  function defineComponent(tagName, constructor) {
    globalComponentRegistry.register(tagName, constructor);
  }
  function lazyComponent(tagName, loader) {
    globalComponentRegistry.register(tagName, loader);
  }

  // src/router/navigation-router.js
  var NavigationRouter = class {
    constructor(app) {
      this.app = app;
      this.handleNavigate = this.handleNavigate.bind(this);
      this.handleClick = this.handleClick.bind(this);
    }
    start() {
      if (!("navigation" in window)) {
        throw new Error("Roselt.js requires the Navigation API.");
      }
      navigation.addEventListener("navigate", this.handleNavigate);
      document.addEventListener("click", this.handleClick);
    }
    stop() {
      if ("navigation" in window) {
        navigation.removeEventListener("navigate", this.handleNavigate);
      }
      document.removeEventListener("click", this.handleClick);
    }
    async bootstrap() {
      const url = new URL(window.location.href);
      await this.app.renderUrl(url);
    }
    handleClick(event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const element = target.closest("[href]");
      if (!(element instanceof Element)) {
        return;
      }
      if (element.matches("a[href], area[href]")) {
        return;
      }
      if (element.hasAttribute("download")) {
        return;
      }
      const navigationTarget = element.getAttribute("target");
      if (navigationTarget && navigationTarget !== "_self") {
        return;
      }
      const href = element.getAttribute("href");
      if (!href) {
        return;
      }
      const destinationUrl = new URL(href, window.location.href);
      if (destinationUrl.origin !== window.location.origin) {
        return;
      }
      event.preventDefault();
      this.app.navigate(destinationUrl).catch((error) => {
        console.error("Roselt.js navigation failed.", error);
      });
    }
    handleNavigate(event) {
      if (!event.canIntercept || event.downloadRequest !== null || event.hashChange) {
        return;
      }
      const destinationUrl = new URL(event.destination.url);
      if (destinationUrl.origin !== window.location.origin) {
        return;
      }
      const routeMatch = this.app.resolve(destinationUrl);
      if (!routeMatch.route) {
        return;
      }
      event.intercept({
        scroll: "manual",
        handler: async () => {
          await this.app.renderUrl(destinationUrl, routeMatch);
          if (destinationUrl.hash) {
            const target = document.getElementById(destinationUrl.hash.slice(1));
            if (target) {
              target.scrollIntoView();
              return;
            }
          }
          event.scroll();
        }
      });
    }
  };

  // src/router/route-resolver.js
  function normalizePageId(pageId, defaultPage) {
    if (!pageId) {
      return defaultPage;
    }
    return pageId.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\\/g, "/") || defaultPage;
  }
  function createAutomaticRoute(pageId, options) {
    const normalizedPageId = normalizePageId(pageId, options.defaultPage);
    return {
      name: normalizedPageId,
      query: normalizedPageId,
      path: normalizedPageId === options.defaultPage ? "/" : `/${normalizedPageId}`,
      html: `${options.pagesDirectory}/${normalizedPageId}.html`,
      module: `${options.pagesDirectory}/${normalizedPageId}.js`
    };
  }
  function tokenizePath(pattern) {
    return normalizePathname(pattern).split("/").filter(Boolean);
  }
  function matchPath(pattern, pathname) {
    const patternTokens = tokenizePath(pattern);
    const pathTokens = tokenizePath(pathname);
    if (patternTokens.length !== pathTokens.length) {
      return null;
    }
    const params = {};
    for (let index = 0; index < patternTokens.length; index += 1) {
      const patternToken = patternTokens[index];
      const pathToken = pathTokens[index];
      if (patternToken.startsWith(":")) {
        params[patternToken.slice(1)] = decodeURIComponent(pathToken);
        continue;
      }
      if (patternToken !== pathToken) {
        return null;
      }
    }
    return params;
  }
  function resolveRoute(routes, currentUrl, options) {
    const { routingMode, queryParam, basePath } = options;
    if (!routes.length) {
      if (routingMode === "pathname") {
        const relativePath = stripBasePath(currentUrl.pathname, basePath);
        const pageId2 = relativePath === "/" ? options.defaultPage : relativePath.slice(1);
        return { route: createAutomaticRoute(pageId2, options), params: {} };
      }
      const pageId = currentUrl.searchParams.get(queryParam) ?? options.defaultPage;
      return { route: createAutomaticRoute(pageId, options), params: {} };
    }
    if (routingMode === "pathname") {
      const relativePath = stripBasePath(currentUrl.pathname, basePath);
      for (const route of routes) {
        if (!route.path) {
          continue;
        }
        const params = matchPath(route.path, relativePath);
        if (params) {
          return { route, params };
        }
      }
    } else {
      const requestedPage = currentUrl.searchParams.get(queryParam);
      if (requestedPage) {
        for (const route of routes) {
          if ((route.query ?? route.name) === requestedPage) {
            return { route, params: {} };
          }
        }
      }
      const defaultRoute = routes.find((route) => route.default) ?? routes[0];
      if (defaultRoute) {
        return { route: defaultRoute, params: {} };
      }
    }
    return { route: null, params: {} };
  }
  function createHrefBuilder(routes, options) {
    const { routingMode, queryParam, basePath } = options;
    return function href(target, parameters = {}, sourceUrl = new URL(window.location.href)) {
      const route = !routes.length ? createAutomaticRoute(typeof target === "string" ? target : target?.name, options) : typeof target === "string" ? routes.find(
        (candidate) => candidate.name === target || candidate.query === target || candidate.path === target
      ) : target;
      if (!route) {
        throw new Error(`Unknown route: ${target}`);
      }
      const url = new URL(sourceUrl.href);
      if (routingMode === "pathname") {
        let pathname = route.path || "/";
        pathname = pathname.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
          const value = parameters[key];
          if (value === void 0 || value === null) {
            throw new Error(`Missing pathname parameter: ${key}`);
          }
          return encodeURIComponent(String(value));
        });
        url.pathname = joinUrlPath(basePath, pathname);
        url.search = "";
      } else {
        url.pathname = sourceUrl.pathname || joinUrlPath(basePath, "/");
        url.searchParams.set(queryParam, route.query ?? route.name);
        for (const [key, value] of Object.entries(parameters)) {
          if (value === void 0 || value === null) {
            url.searchParams.delete(key);
          } else {
            url.searchParams.set(key, String(value));
          }
        }
      }
      return url.toString();
    };
  }

  // src/runtime/page-script.js
  function createDefinition(url) {
    return {
      url,
      exports: {},
      meta: {},
      stylesheets: [],
      components: {},
      load: null,
      promise: null
    };
  }
  var definitions = /* @__PURE__ */ new Map();
  var activeDefinition = null;
  var activeApp = null;
  var activePageContext = null;
  function withActiveDefinition(callback) {
    if (!activeDefinition) {
      return void 0;
    }
    return callback(activeDefinition);
  }
  function normalizeArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    return value ? [value] : [];
  }
  function requireActiveApp() {
    if (!activeApp) {
      throw new Error("Roselt has not been started yet.");
    }
    return activeApp;
  }
  function readCurrentRouteMatch() {
    return activeApp ? activeApp.currentRoute() : null;
  }
  function requireActivePageContext() {
    if (!activePageContext) {
      throw new Error("Roselt.Page runtime helpers are only available while a page is mounted.");
    }
    return activePageContext;
  }
  function readActivePageElement() {
    return activePageContext?.page ?? activeApp?.pageRoot ?? null;
  }
  function requireActivePageElement() {
    const pageElement = readActivePageElement();
    if (!pageElement) {
      throw new Error("Roselt.Page DOM helpers are only available while a page is mounted.");
    }
    return pageElement;
  }
  function ensurePageApi() {
    const roseltNamespace = globalThis.Roselt ?? {};
    if (!Object.prototype.hasOwnProperty.call(roseltNamespace, "Page")) {
      Object.defineProperty(roseltNamespace, "Page", {
        enumerable: true,
        configurable: true,
        value: {
          get Title() {
            return activeDefinition?.meta.title;
          },
          set Title(value) {
            withActiveDefinition((definition) => {
              definition.meta.title = value;
            });
          },
          get Description() {
            return activeDefinition?.meta.description;
          },
          set Description(value) {
            withActiveDefinition((definition) => {
              definition.meta.description = value;
            });
          },
          get Canonical() {
            return activeDefinition?.meta.canonical;
          },
          set Canonical(value) {
            withActiveDefinition((definition) => {
              definition.meta.canonical = value;
            });
          },
          get Stylesheets() {
            return activeDefinition?.stylesheets ?? [];
          },
          set Stylesheets(value) {
            withActiveDefinition((definition) => {
              definition.stylesheets = normalizeArray(value);
            });
          },
          get Components() {
            return activeDefinition?.components ?? {};
          },
          set Components(value) {
            withActiveDefinition((definition) => {
              definition.components = value || {};
            });
          },
          get Load() {
            return activeDefinition?.load;
          },
          set Load(value) {
            withActiveDefinition((definition) => {
              definition.load = value;
            });
          },
          querySelector(selector) {
            return requireActivePageElement().querySelector(selector);
          },
          querySelectorAll(selector) {
            return requireActivePageElement().querySelectorAll(selector);
          },
          get route() {
            return activePageContext?.route ?? readCurrentRouteMatch()?.route ?? null;
          },
          get params() {
            return activePageContext?.params ?? readCurrentRouteMatch()?.params ?? {};
          },
          get notFound() {
            return activePageContext?.notFound ?? readCurrentRouteMatch()?.notFound ?? null;
          },
          get url() {
            return activePageContext?.url ?? (activeApp ? activeApp.currentUrl() : null);
          },
          get query() {
            return activePageContext?.query ?? (activeApp ? Object.fromEntries(activeApp.currentUrl().searchParams.entries()) : {});
          },
          href(target, parameters = {}) {
            if (activePageContext) {
              return activePageContext.href(target, parameters);
            }
            return requireActiveApp().href(target, parameters);
          },
          navigate(target, parameters = {}, navigationOptions = {}) {
            if (activePageContext) {
              return activePageContext.navigate(target, parameters, navigationOptions);
            }
            return requireActiveApp().navigate(target, parameters, navigationOptions);
          },
          cleanup(callback) {
            return requireActivePageContext().cleanup(callback);
          }
        }
      });
    }
    if (!Object.prototype.hasOwnProperty.call(roseltNamespace, "app")) {
      Object.defineProperty(roseltNamespace, "app", {
        enumerable: true,
        configurable: true,
        get() {
          return activeApp;
        }
      });
    }
    if (!Object.prototype.hasOwnProperty.call(roseltNamespace, "navigate")) {
      Object.defineProperty(roseltNamespace, "navigate", {
        enumerable: true,
        configurable: true,
        value(target, parameters = {}, navigationOptions = {}) {
          return requireActiveApp().navigate(target, parameters, navigationOptions);
        }
      });
    }
    if (!Object.prototype.hasOwnProperty.call(roseltNamespace, "href")) {
      Object.defineProperty(roseltNamespace, "href", {
        enumerable: true,
        configurable: true,
        value(target, parameters = {}) {
          return requireActiveApp().href(target, parameters);
        }
      });
    }
    if (!Object.prototype.hasOwnProperty.call(roseltNamespace, "currentUrl")) {
      Object.defineProperty(roseltNamespace, "currentUrl", {
        enumerable: true,
        configurable: true,
        value() {
          return requireActiveApp().currentUrl();
        }
      });
    }
    if (!Object.prototype.hasOwnProperty.call(roseltNamespace, "currentRoute")) {
      Object.defineProperty(roseltNamespace, "currentRoute", {
        enumerable: true,
        configurable: true,
        value() {
          return requireActiveApp().currentRoute();
        }
      });
    }
    globalThis.Roselt = roseltNamespace;
  }
  ensurePageApi();
  function createEmptyPageScript() {
    return createDefinition("");
  }
  function setActiveRoseltApp(app) {
    activeApp = app;
  }
  function clearActiveRoseltApp(app) {
    if (!app || activeApp === app) {
      activeApp = null;
    }
  }
  function setActivePageContext(context) {
    activePageContext = context ?? null;
  }
  function clearActivePageContext(context) {
    if (!context || activePageContext === context) {
      activePageContext = null;
    }
  }
  async function loadPageScript(url) {
    if (!definitions.has(url)) {
      definitions.set(url, createDefinition(url));
    }
    const definition = definitions.get(url);
    if (!definition.promise) {
      definition.promise = (async () => {
        activeDefinition = definition;
        try {
          const source = await loadClassicScript(url, { optional: true });
          definition.exports = source === null ? {} : definition.exports;
          return definition;
        } finally {
          activeDefinition = null;
        }
      })();
    }
    return definition.promise;
  }
  function normalizePageScript(definition) {
    return {
      meta: {
        ...definition?.meta || {}
      },
      stylesheets: [...definition?.stylesheets || []],
      components: {
        ...definition?.components || {}
      },
      load: definition?.load ?? null
    };
  }

  // src/runtime/page-loader.js
  function createMissingPageError(url, cause) {
    const error = new Error(`Failed to load page HTML: ${url}`);
    error.code = "ROSELT_PAGE_NOT_FOUND";
    error.pageUrl = url;
    error.cause = cause;
    return error;
  }
  function isMissingPageFetchError(error) {
    if (error?.code === "ROSELT_PAGE_NOT_FOUND") {
      return true;
    }
    const message = String(error);
    return error instanceof TypeError || message.includes("Failed to fetch") || message.includes("NetworkError");
  }
  var PageLoader = class {
    constructor() {
      this.htmlCache = /* @__PURE__ */ new Map();
      this.moduleCache = /* @__PURE__ */ new Map();
      this.stylesheetCache = /* @__PURE__ */ new Map();
    }
    async load(route) {
      const htmlUrl = route.html ? resolveUrl(route.html) : route.htmlUrl ? resolveUrl(route.htmlUrl) : document.baseURI;
      const moduleUrl = typeof route.module === "string" ? resolveUrl(route.module) : route.moduleUrl ? resolveUrl(route.moduleUrl) : document.baseURI;
      const html = await (route.htmlContent ?? this.loadHtml(htmlUrl));
      const module = await (route.moduleObject ?? (typeof route.module === "function" && !route.module.prototype ? route.module() : this.loadModule(moduleUrl)));
      return {
        html,
        module,
        htmlUrl,
        moduleUrl
      };
    }
    loadHtml(url) {
      if (!this.htmlCache.has(url)) {
        this.htmlCache.set(
          url,
          fetch(resolveBrowserLoadUrl(url)).then(async (response) => {
            if (!response.ok) {
              throw createMissingPageError(url);
            }
            return response.text();
          }).catch((error) => {
            if (isMissingPageFetchError(error)) {
              throw createMissingPageError(url, error);
            }
            throw error;
          })
        );
      }
      return this.htmlCache.get(url);
    }
    loadModule(url) {
      if (!this.moduleCache.has(url)) {
        this.moduleCache.set(
          url,
          loadPageScript(url).then((definition) => normalizePageScript(definition)).catch((error) => {
            const message = String(error);
            if (message.includes("Failed to fetch dynamically imported module") || message.includes("Cannot find module") || message.includes("Importing a module script failed")) {
              return normalizePageScript(createEmptyPageScript());
            }
            throw error;
          })
        );
      }
      return this.moduleCache.get(url);
    }
    loadStylesheet(url, { optional = false } = {}) {
      const cacheKey = `${optional ? "optional" : "required"}:${url}`;
      if (!this.stylesheetCache.has(cacheKey)) {
        this.stylesheetCache.set(
          cacheKey,
          fetch(resolveBrowserLoadUrl(url)).then(async (response) => {
            if (!response.ok) {
              if (optional) {
                return null;
              }
              throw new Error(`Failed to load stylesheet: ${url}`);
            }
            return {
              href: url,
              cssText: await response.text()
            };
          }).catch((error) => {
            if (optional) {
              const message = String(error);
              if (error instanceof TypeError || message.includes("Failed to fetch") || message.includes("NetworkError")) {
                return null;
              }
            }
            throw error;
          })
        );
      }
      return this.stylesheetCache.get(cacheKey);
    }
    clear() {
      this.htmlCache.clear();
      this.moduleCache.clear();
      this.stylesheetCache.clear();
    }
    isMissingPageError(error) {
      return error?.code === "ROSELT_PAGE_NOT_FOUND";
    }
  };

  // src/seo/head-manager.js
  var managedSelector = "[data-navigate-managed]";
  function upsertMeta(name, content, attribute = "name") {
    if (!content) {
      const existing = document.head.querySelector(`meta[${attribute}="${name}"]${managedSelector}`);
      if (existing) {
        existing.remove();
      }
      return;
    }
    let element = document.head.querySelector(`meta[${attribute}="${name}"]`);
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, name);
      document.head.appendChild(element);
    }
    element.setAttribute("content", content);
    element.setAttribute("data-navigate-managed", "true");
  }
  function upsertCanonical(href) {
    if (!href) {
      const existing = document.head.querySelector(`link[rel="canonical"]${managedSelector}`);
      if (existing) {
        existing.remove();
      }
      return;
    }
    let element = document.head.querySelector('link[rel="canonical"]');
    if (!element) {
      element = document.createElement("link");
      element.rel = "canonical";
      document.head.appendChild(element);
    }
    element.href = href;
    element.setAttribute("data-navigate-managed", "true");
  }
  function applyHead(route, pageModule, runtimeMeta, currentUrl) {
    const meta = {
      ...route.meta || {},
      ...pageModule.meta || {},
      ...runtimeMeta || {}
    };
    if (meta.title) {
      document.title = meta.title;
    }
    upsertMeta("description", meta.description);
    upsertMeta("og:title", meta.ogTitle ?? meta.title, "property");
    upsertMeta("og:description", meta.ogDescription ?? meta.description, "property");
    upsertMeta("twitter:title", meta.twitterTitle ?? meta.title);
    upsertMeta("twitter:description", meta.twitterDescription ?? meta.description);
    const canonical = meta.canonical ? new URL(meta.canonical, currentUrl).href : currentUrl.href;
    upsertCanonical(canonical);
  }

  // src/runtime/render-engine.js
  var NOT_FOUND_PAGE_ID = "404";
  function dedupeStylesheets(entries) {
    const seen = /* @__PURE__ */ new Set();
    return entries.filter((entry) => {
      if (!entry?.href || seen.has(entry.href)) {
        return false;
      }
      seen.add(entry.href);
      return true;
    });
  }
  function resolveDefinitions(definitions2 = {}, baseUrl = document.baseURI) {
    return Object.fromEntries(
      Object.entries(definitions2).map(([tagName, definition]) => [
        tagName,
        typeof definition === "string" ? resolveUrl(definition, baseUrl) : definition
      ])
    );
  }
  function createSiblingStylesheetUrl(htmlUrl) {
    const url = new URL(htmlUrl);
    if (!url.pathname.endsWith(".html")) {
      return null;
    }
    url.pathname = url.pathname.replace(/\.html$/, ".css");
    return url.href;
  }
  function normalizeInitialStylesheets(route, pageModule, pageHtmlUrl, pageModuleUrl, hasInlineStyles) {
    return dedupeStylesheets([
      ...!hasInlineStyles ? [
        {
          href: createSiblingStylesheetUrl(pageHtmlUrl),
          optional: true
        }
      ] : [],
      ...(route.stylesheets || []).map((href) => ({
        href: resolveUrl(href, document.baseURI),
        optional: false
      })),
      ...(pageModule.stylesheets || []).map((href) => ({
        href: resolveUrl(href, pageModuleUrl),
        optional: false
      }))
    ]);
  }
  function normalizeRuntimeStylesheets(runtimeMeta, currentUrl) {
    return dedupeStylesheets(
      (runtimeMeta?.stylesheets || []).map((href) => ({
        href: resolveUrl(href, currentUrl.href),
        optional: false
      }))
    );
  }
  function extractInlineStyles(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const inlineStyles = Array.from(template.content.querySelectorAll("style"), (element) => {
      const cssText = element.textContent || "";
      element.remove();
      return cssText;
    }).filter(Boolean);
    return {
      html: template.innerHTML,
      inlineStyles
    };
  }
  function createPageCleanupManager() {
    const callbacks = [];
    return {
      add(callback) {
        if (typeof callback === "function") {
          callbacks.push(callback);
        }
        return callback;
      },
      async run() {
        while (callbacks.length > 0) {
          const callback = callbacks.pop();
          await callback();
        }
      }
    };
  }
  function normalizeEventListenerOptions(options, signal) {
    if (typeof options === "boolean") {
      return {
        capture: options,
        signal
      };
    }
    if (!options) {
      return { signal };
    }
    if (options.signal && typeof AbortSignal?.any === "function") {
      return {
        ...options,
        signal: AbortSignal.any([options.signal, signal])
      };
    }
    if (options.signal) {
      return options;
    }
    return {
      ...options,
      signal
    };
  }
  async function capturePageEventListeners(callback) {
    const controller = new AbortController();
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
      return originalAddEventListener.call(
        this,
        type,
        listener,
        normalizeEventListenerOptions(options, controller.signal)
      );
    };
    try {
      return {
        result: await callback(),
        cleanup() {
          controller.abort();
        }
      };
    } catch (error) {
      controller.abort();
      throw error;
    } finally {
      EventTarget.prototype.addEventListener = originalAddEventListener;
    }
  }
  function createPageContext(app, routeMatch, currentUrl, cleanupManager) {
    return {
      app,
      route: routeMatch.route,
      params: routeMatch.params,
      notFound: routeMatch.notFound ?? null,
      url: currentUrl,
      page: app.pageRoot,
      href: (target, parameters) => app.href(target, parameters, currentUrl),
      navigate: (target, parameters, navigationOptions) => app.navigate(target, parameters, navigationOptions),
      query: Object.fromEntries(currentUrl.searchParams.entries()),
      cleanup: (callback) => cleanupManager.add(callback)
    };
  }
  function createNotFoundRoute(options) {
    return {
      name: NOT_FOUND_PAGE_ID,
      query: NOT_FOUND_PAGE_ID,
      path: `/${NOT_FOUND_PAGE_ID}`,
      html: `${options.pagesDirectory}/${NOT_FOUND_PAGE_ID}.html`,
      module: `${options.pagesDirectory}/${NOT_FOUND_PAGE_ID}.js`
    };
  }
  function isNotFoundRoute(route) {
    return route?.name === NOT_FOUND_PAGE_ID || route?.query === NOT_FOUND_PAGE_ID;
  }
  var RenderEngine = class {
    constructor(app, loader, sections, components) {
      this.app = app;
      this.loader = loader;
      this.sections = sections;
      this.components = components;
      this.pageCleanup = null;
      this.activeStyleElements = [];
    }
    async render(routeMatch, currentUrl) {
      if (!routeMatch.route) {
        await this.renderNotFound(currentUrl, routeMatch);
        return;
      }
      try {
        await this.renderPage(routeMatch, currentUrl);
      } catch (error) {
        if (this.loader.isMissingPageError(error)) {
          await this.renderNotFound(currentUrl, routeMatch);
          return;
        }
        throw error;
      }
    }
    async renderPage(routeMatch, currentUrl) {
      const page = await this.loader.load(routeMatch.route);
      const pageUsesInlineStyles = extractInlineStyles(page.html).inlineStyles.length > 0;
      const resolvedHtml = await this.sections.resolveIncludes(page.html, page.htmlUrl);
      const extractedPage = extractInlineStyles(resolvedHtml);
      const cleanupManager = createPageCleanupManager();
      const pageContext = createPageContext(this.app, routeMatch, currentUrl, cleanupManager);
      const initialStylesheets = await Promise.all(
        normalizeInitialStylesheets(
          routeMatch.route,
          page.module,
          page.htmlUrl,
          page.moduleUrl,
          pageUsesInlineStyles
        ).map((entry) => this.loader.loadStylesheet(entry.href, { optional: entry.optional }))
      );
      await this.cleanup();
      this.activeStyleElements = this.applyStyles(initialStylesheets, extractedPage.inlineStyles);
      this.app.pageRoot.innerHTML = extractedPage.html;
      this.components.registerAll(resolveDefinitions(routeMatch.route.components, document.baseURI));
      this.components.registerAll(resolveDefinitions(page.module.components, page.moduleUrl));
      await this.components.ensureForRoot(
        this.app.pageRoot,
        (tagName) => this.app.resolveComponent(tagName)
      );
      await this.sections.hydrateRoot(this.app.pageRoot);
      setActivePageContext(pageContext);
      const loadFunction = page.module.load;
      let runtimeMeta = {};
      try {
        if (typeof loadFunction === "function") {
          const { result: mountResult, cleanup: cleanupListeners } = await capturePageEventListeners(
            () => loadFunction(pageContext)
          );
          cleanupManager.add(cleanupListeners);
          cleanupManager.add(mountResult?.destroy ?? mountResult?.cleanup ?? mountResult ?? null);
          runtimeMeta = mountResult?.meta ?? {};
        }
        this.pageCleanup = async () => {
          await cleanupManager.run();
          clearActivePageContext(pageContext);
        };
        const runtimeStylesheets = await Promise.all(
          normalizeRuntimeStylesheets(runtimeMeta, currentUrl).map((entry) => this.loader.loadStylesheet(entry.href, { optional: entry.optional }))
        );
        this.activeStyleElements.push(...this.applyStyles(runtimeStylesheets));
        applyHead(routeMatch.route, page.module, runtimeMeta, currentUrl);
      } catch (error) {
        clearActivePageContext(pageContext);
        await cleanupManager.run();
        throw error;
      }
    }
    applyStyles(stylesheets, inlineStyles = []) {
      const styleElements = [];
      for (const stylesheet of stylesheets) {
        if (!stylesheet?.cssText) {
          continue;
        }
        const style = document.createElement("style");
        style.textContent = stylesheet.cssText;
        style.setAttribute("data-navigate-page-style", "true");
        style.setAttribute("data-navigate-source", stylesheet.href);
        document.head.appendChild(style);
        styleElements.push(style);
      }
      for (const cssText of inlineStyles) {
        const style = document.createElement("style");
        style.textContent = cssText;
        style.setAttribute("data-navigate-page-style", "true");
        style.setAttribute("data-navigate-source", "inline");
        document.head.appendChild(style);
        styleElements.push(style);
      }
      return styleElements;
    }
    async cleanup() {
      if (typeof this.pageCleanup === "function") {
        await this.pageCleanup();
      }
      this.pageCleanup = null;
      for (const styleElement of this.activeStyleElements) {
        styleElement.remove();
      }
      this.activeStyleElements = [];
    }
    async renderNotFound(currentUrl, routeMatch = { route: null, params: {} }) {
      if (!isNotFoundRoute(routeMatch.route)) {
        const customNotFoundMatch = {
          route: createNotFoundRoute(this.app.options),
          params: {},
          notFound: {
            route: routeMatch.route,
            url: currentUrl
          }
        };
        try {
          await this.renderPage(customNotFoundMatch, currentUrl);
          return;
        } catch (error) {
          if (!this.loader.isMissingPageError(error)) {
            throw error;
          }
        }
      }
      await this.cleanup();
      const section = document.createElement("section");
      const heading = document.createElement("h1");
      const description = document.createElement("p");
      heading.textContent = "Page Not Found";
      description.textContent = `No Roselt.js page matched ${currentUrl.pathname}${currentUrl.search}.`;
      section.append(heading, description);
      this.app.pageRoot.replaceChildren(section);
      document.title = "Page Not Found";
    }
  };

  // src/runtime/section-loader.js
  function createSiblingResourceUrl(sectionUrl, extension) {
    const url = new URL(sectionUrl);
    if (!url.pathname.endsWith(".html")) {
      return null;
    }
    url.pathname = url.pathname.replace(/\.html$/, extension);
    return url.href;
  }
  function isShorthandSectionReference(value) {
    return Boolean(value) && !value.includes("/") && !value.includes(".") && !value.includes(":");
  }
  var SectionLoader = class {
    constructor(options = {}) {
      const { sectionsDirectory = "sections" } = options;
      this.sectionsDirectory = sectionsDirectory;
      this.sectionCache = /* @__PURE__ */ new Map();
      this.stylesheetCache = /* @__PURE__ */ new Map();
      this.appliedStylesheets = /* @__PURE__ */ new Map();
    }
    async resolveRootIncludes(root, baseUrl = document.baseURI) {
      await this.processTemplate(root, baseUrl);
    }
    async resolveIncludes(html, baseUrl) {
      const template = document.createElement("template");
      template.innerHTML = html;
      await this.processTemplate(template.content, baseUrl);
      return template.innerHTML;
    }
    async processTemplate(root, baseUrl) {
      const includes = Array.from(root.querySelectorAll("roselt[section]"));
      for (const includeNode of includes) {
        const src = includeNode.getAttribute("section");
        if (!src) {
          includeNode.remove();
          continue;
        }
        const sectionUrl = isShorthandSectionReference(src) ? resolveUrl(`${this.sectionsDirectory}/${src}.html`, document.baseURI) : resolveUrl(src, baseUrl);
        const sectionHtml = await this.loadSection(sectionUrl);
        const resolvedHtml = await this.resolveIncludes(sectionHtml, sectionUrl);
        const replacement = document.createRange().createContextualFragment(resolvedHtml);
        this.annotateSectionFragment(replacement, sectionUrl);
        includeNode.replaceWith(replacement);
      }
    }
    annotateSectionFragment(fragment, sectionUrl) {
      for (const node of Array.from(fragment.childNodes)) {
        if (!(node instanceof Element)) {
          continue;
        }
        node.setAttribute("data-roselt-section-source", sectionUrl);
      }
    }
    loadSection(url) {
      if (!this.sectionCache.has(url)) {
        this.sectionCache.set(
          url,
          fetch(resolveBrowserLoadUrl(url)).then(async (response) => {
            if (!response.ok) {
              throw new Error(`Failed to load section HTML: ${url}`);
            }
            return response.text();
          })
        );
      }
      return this.sectionCache.get(url);
    }
    loadStylesheet(url, { optional = false } = {}) {
      const cacheKey = `${optional ? "optional" : "required"}:${url}`;
      if (!this.stylesheetCache.has(cacheKey)) {
        this.stylesheetCache.set(
          cacheKey,
          fetch(resolveBrowserLoadUrl(url)).then(async (response) => {
            if (!response.ok) {
              if (optional) {
                return null;
              }
              throw new Error(`Failed to load stylesheet: ${url}`);
            }
            return {
              href: url,
              cssText: await response.text()
            };
          }).catch((error) => {
            if (optional) {
              const message = String(error);
              if (error instanceof TypeError || message.includes("Failed to fetch") || message.includes("NetworkError")) {
                return null;
              }
            }
            throw error;
          })
        );
      }
      return this.stylesheetCache.get(cacheKey);
    }
    async ensureSectionAssets(sectionUrl) {
      const stylesheetUrl = createSiblingResourceUrl(sectionUrl, ".css");
      const scriptUrl = createSiblingResourceUrl(sectionUrl, ".js");
      if (stylesheetUrl) {
        await this.ensureSectionStylesheet(stylesheetUrl);
      }
      if (scriptUrl) {
        await loadClassicScript(scriptUrl, { optional: true });
      }
    }
    async ensureSectionStylesheet(url) {
      if (this.appliedStylesheets.has(url)) {
        return this.appliedStylesheets.get(url);
      }
      const promise = (async () => {
        const stylesheet = await this.loadStylesheet(url, { optional: true });
        if (!stylesheet?.cssText) {
          return null;
        }
        const style = document.createElement("style");
        style.textContent = stylesheet.cssText;
        style.setAttribute("data-roselt-section-style", "true");
        style.setAttribute("data-roselt-source", stylesheet.href);
        document.head.append(style);
        return style;
      })();
      this.appliedStylesheets.set(url, promise);
      return promise;
    }
    async hydrateRoot(root) {
      const sectionUrls = /* @__PURE__ */ new Set();
      if (root instanceof Element && root.hasAttribute("data-roselt-section-source")) {
        sectionUrls.add(root.getAttribute("data-roselt-section-source"));
      }
      if (root && typeof root.querySelectorAll === "function") {
        for (const element of root.querySelectorAll("[data-roselt-section-source]")) {
          sectionUrls.add(element.getAttribute("data-roselt-section-source"));
        }
      }
      await Promise.all(
        Array.from(sectionUrls).filter(Boolean).map((sectionUrl) => this.ensureSectionAssets(sectionUrl))
      );
    }
  };

  // src/Roselt.js
  var DEFAULT_PAGE_ROOT_SELECTOR = "roselt[page][navigate]";
  function resolvePageRoot(pageRoot) {
    if (typeof pageRoot !== "string") {
      return pageRoot;
    }
    return document.querySelector(pageRoot);
  }
  function resolveDefaultPage(pageRoot, configuredDefaultPage) {
    if (configuredDefaultPage) {
      return configuredDefaultPage;
    }
    if (pageRoot instanceof Element && pageRoot.hasAttribute("page")) {
      return pageRoot.getAttribute("page") || "home";
    }
    return "home";
  }
  function createEntryAssetUrl(extension, baseUrl = document.baseURI) {
    const url = new URL(baseUrl, document.baseURI);
    const pathname = url.pathname;
    const lastSegment = pathname.split("/").pop() || "";
    if (pathname.endsWith("/")) {
      url.pathname = `${pathname}index${extension}`;
      return url.href;
    }
    if (lastSegment.endsWith(".html")) {
      url.pathname = pathname.replace(/\.html$/, extension);
      return url.href;
    }
    if (!lastSegment.includes(".")) {
      url.pathname = `${pathname.replace(/\/?$/, "/")}index${extension}`;
      return url.href;
    }
    return null;
  }
  function hasResolvedAssetReference(selector, attribute, assetUrl) {
    return Array.from(document.querySelectorAll(selector)).some((element) => {
      const value = element.getAttribute(attribute);
      return value && new URL(value, document.baseURI).href === assetUrl;
    });
  }
  function hasAppliedEntryStylesheet(assetUrl) {
    return Array.from(document.querySelectorAll("style[data-roselt-entry-style]")).some(
      (styleElement) => styleElement.getAttribute("data-roselt-entry-style") === assetUrl
    );
  }
  var Roselt = class _Roselt {
    constructor(options = {}) {
      const {
        pageRoot = DEFAULT_PAGE_ROOT_SELECTOR,
        routes = [],
        routingMode = "query",
        queryParam = "page",
        basePath,
        components = {},
        pagesDirectory = "pages",
        sectionsDirectory = "sections",
        componentsDirectory = "components",
        defaultPage
      } = options;
      this.routes = routes;
      this.pageRoot = resolvePageRoot(pageRoot);
      const resolvedDefaultPage = resolveDefaultPage(this.pageRoot, defaultPage);
      this.options = {
        routingMode,
        queryParam,
        basePath: basePath ?? deriveBasePath(),
        pagesDirectory,
        sectionsDirectory,
        componentsDirectory,
        defaultPage: resolvedDefaultPage
      };
      if (!this.pageRoot) {
        throw new Error("Roselt.js could not find a roselt[page][navigate] page root.");
      }
      this.loader = new PageLoader();
      this.sections = new SectionLoader({
        sectionsDirectory: this.options.sectionsDirectory
      });
      this.components = globalComponentRegistry;
      this.components.registerAll(components);
      this.renderer = new RenderEngine(this, this.loader, this.sections, this.components);
      this.router = new NavigationRouter(this);
      this.started = false;
      this.href = createHrefBuilder(this.routes, this.options);
    }
    async ensureEntryAssets() {
      const stylesheetUrl = createEntryAssetUrl(".css");
      if (stylesheetUrl && !hasResolvedAssetReference('link[rel="stylesheet"][href]', "href", stylesheetUrl) && !hasAppliedEntryStylesheet(stylesheetUrl)) {
        const stylesheet = await this.loader.loadStylesheet(stylesheetUrl, { optional: true });
        if (stylesheet?.cssText) {
          const style = document.createElement("style");
          style.textContent = stylesheet.cssText;
          style.setAttribute("data-roselt-entry-style", stylesheet.href);
          document.head.append(style);
        }
      }
      const scriptUrl = createEntryAssetUrl(".js");
      if (scriptUrl && !hasResolvedAssetReference("script[src]", "src", scriptUrl)) {
        await loadClassicScript(scriptUrl, { optional: true });
      }
    }
    start() {
      if (this.started) {
        return Promise.resolve();
      }
      return this.ensureEntryAssets().then(() => this.sections.resolveRootIncludes(document.body)).then(async () => {
        await this.components.ensureForRoot(
          document.body,
          (tagName) => this.resolveComponent(tagName)
        );
        await this.sections.hydrateRoot(document.body);
        this.router.start();
        setActiveRoseltApp(this);
        this.started = true;
        return this.router.bootstrap();
      });
    }
    stop() {
      this.router.stop();
      clearActiveRoseltApp(this);
      this.started = false;
    }
    resolve(url) {
      return resolveRoute(this.routes, url, this.options);
    }
    async renderUrl(url, routeMatch = this.resolve(url)) {
      await this.renderer.render(routeMatch, url);
    }
    async navigate(target, parameters = {}, navigationOptions = {}) {
      const url = target instanceof URL ? target : new URL(this.href(target, parameters, new URL(window.location.href)));
      return navigation.navigate(url.toString(), navigationOptions).finished;
    }
    currentUrl() {
      return new URL(window.location.href);
    }
    currentRoute() {
      return this.resolve(this.currentUrl());
    }
    resolveComponent(tagName) {
      return `${this.options.componentsDirectory}/${tagName}.js`;
    }
    rootHref() {
      return joinUrlPath(this.options.basePath, "/");
    }
    static async start(options = {}) {
      const app = new _Roselt(options);
      await app.start();
      return app;
    }
  };
  var Roselt_default = Roselt;

  // src/index.js
  async function start(options) {
    return Roselt_default.start(options);
  }

  // src/browser-global.js
  Object.assign(globalThis.Roselt ?? {}, {
    Roselt: Roselt_default,
    start,
    ComponentRegistry,
    defineComponent,
    globalComponentRegistry,
    lazyComponent
  });
})();
