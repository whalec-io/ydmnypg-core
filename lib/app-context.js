import { readFileSync } from "fs";
import path from "path";
import requestStore from "./request-store.js";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:app-context");

class AppContext {
  get request() {
    return requestStore.getStore()?.req || null;
  }

  get userAgent() {
    return requestStore.getStore()?.ua || null;
  }

  get docPath() {
    return this.config.docPath;
  }

  normalizePath(val) {
    if (val && val.startsWith("/")) {
      return val.slice(1);
    }
    return val;
  }

  normalizePort(val) {
    const port = parseInt(val, 10);
    if (isNaN(port)) return val;
    if (port >= 0) return port;
    return false;
  }

  getCliArgs(key) {
    const values = [];
    const args = (process.env.YS_API_ARGS && process.env.YS_API_ARGS.split(" ")) || process.argv;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === key && args[i + 1]) {
        values.push(args[i + 1]);
      }
    }

    return values;
  }

  getScopes(scopes) {
    if (typeof scopes === "string" && scopes) {
      return scopes.split(",");
    }
    if (Array.isArray(scopes) && scopes.length > 0) {
      return scopes;
    }
    return ["api", "admin"];
  }

  constructor(options) {
    const {
      framework,
      appPath,
      config,
      title,
      interfaceVersion,
      helmet,
      limit,
      path: pathOpt,
      host,
      port,
      target,
      createDoc,
      documentFilter,
      autoCreate,
      initMode,
      useScheduler,
      useFavicon,
      useProxy,
      useCookie,
      useSendData,
      useUserAgent,
      useCompression,
      useHttpLogger,
      rateLimit,
      timeout,
      session,
      prefix,
      scopes,
      defaultErrorStatusCode,
    } = options;

    logger.debug("init", {
      port: options.port,
      scopes: options.scopes,
      mode: options.config?.mode,
    });

    this.initMode = initMode === true || autoCreate === true || process.argv.includes("--init");
    this.framework = framework;
    this.appPath = appPath;
    this.config = config;
    this.title = title || "API";
    this.defaultErrorStatusCode = defaultErrorStatusCode || 500;

    try {
      const pkgPath = path.resolve(appPath, "./package.json");
      this.version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    } catch {
      this.version = "0.0.0";
    }

    this.interfaceVersion = interfaceVersion || "v1";
    this.helmet = helmet || { contentSecurityPolicy: false };
    this.limit = limit || "100kb";
    this.path = this.normalizePath(pathOpt || "");
    this.scopes = this.getScopes(scopes || []);

    if (target) {
      const hostValue = config.host[target];
      this.host = (hostValue && hostValue.replace(/(https|http):\/\//g, "")) || "";

      const portValue = config.port[target];
      this.port = this.normalizePort(portValue || 3000);
    } else {
      this.host = host || "";
      this.port = this.normalizePort(port || (config && config.port) || 3000);
    }

    this.createDoc = createDoc === true || config?.createDoc || false;
    this.documentFilter = typeof documentFilter === "function" ? documentFilter : null;
    this.useFavicon = useFavicon === true;
    this.useScheduler = useScheduler === true;
    this.useCookie = useCookie === true;
    this.useProxy = useProxy === true;
    this.useSendData = useSendData === true;
    this.useUserAgent = useUserAgent === true;
    this.useCompression = useCompression === true;
    this.useHttpLogger = useHttpLogger || false;
    this.rateLimit = rateLimit || false;
    this.timeout = timeout || false;
    this.session = session || null;
    this.prefix = prefix || "ys";

    this.shared = {};
    this.options = options;
  }

  setItem(key, value) {
    Object.defineProperty(this.shared, key, {
      value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }

  getItem(key) {
    return this.shared[key];
  }

  option(key) {
    return this.options[key];
  }
}

export default AppContext;
