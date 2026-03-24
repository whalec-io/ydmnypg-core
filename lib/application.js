import _ from "lodash";
import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import { globSync } from "glob";
import { pathToFileURL } from "url";
import favicon from "serve-favicon";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import mustache from "mustache";
import multer from "multer";
import userAgent from "express-useragent";
import requestIp from "request-ip";
import AppContext from "./app-context.js";
import SwaggerBuilder from "./swagger-builder.js";
import Logger from "./logger.js";
import requestStore from "./request-store.js";
const logger = new Logger("ydmnypg:application", 1);

async function tryImport(moduleName) {
  try {
    const mod = await import(moduleName);
    return mod.default ?? mod;
  } catch {
    logger.warn(`Optional module "${moduleName}" is not installed. Skipping.`);
    return null;
  }
}

function attachExceptionHandlers() {
  process.on("uncaughtException", err => {
    logger.error("Uncaught exception", err);
    process.exit(1);
  });

  process.on("unhandledRejection", err => {
    logger.error("Unhandled rejection", err);
    process.exit(1);
  });
}

async function renderDoc(filePath, data = {}) {
  const content = await fs.promises.readFile(filePath, "utf8");
  return mustache.render(content, data);
}

async function importFile(appPath, file) {
  logger.debug("import", file);
  const resolved = path.resolve(appPath, file);
  const mod = await import(pathToFileURL(resolved).href);
  return mod.default ?? mod;
}

function getServiceScopes(context) {
  return context.getCliArgs("--service");
}

async function createDoc(context, routerPaths, models, jsonFileName, scope = "") {
  const swagger = new SwaggerBuilder(context);
  const json = swagger.buildJSON({ routes: routerPaths, models }, scope);
  const swaggerDataPath = path.join(context.appPath, "public/swagger/data");

  await swagger.jsonWriteAsync(path.join(swaggerDataPath, jsonFileName), json);

  return {
    swaggerPath: path.join(context.appPath, "public/swagger"),
    jsonFileName,
  };
}

class Application {
  // ─── 미들웨어 설정 ────────────────────────────────────────────────────────────

  async setupMiddlewares() {
    const ctx = this.context;

    if (ctx.useHttpLogger) {
      const morgan = await tryImport("morgan");
      if (morgan) {
        const format = typeof ctx.useHttpLogger === "string" ? ctx.useHttpLogger : "combined";
        this.use({ key: "HTTP.LOGGER", handler: morgan(format) });
      }
    }

    if (ctx.rateLimit) {
      const rateLimit = await tryImport("express-rate-limit");
      if (rateLimit) {
        this.use({ key: "RATE.LIMIT", handler: rateLimit(ctx.rateLimit) });
      }
    }

    this.use({ key: "HELMET", handler: helmet(ctx.helmet) });
    this.use({ key: "CORS", handler: cors() });

    if (ctx.useCompression) {
      const compression = await tryImport("compression");
      if (compression) {
        this.use({ key: "COMPRESSION", handler: compression() });
      }
    }

    if (ctx.timeout) {
      const connectTimeout = await tryImport("connect-timeout");
      if (connectTimeout) {
        this.use({ key: "TIMEOUT", handler: connectTimeout(ctx.timeout) });
        this.use({
          key: "TIMEOUT.HANDLER",
          handler: (req, res, next) => {
            if (!req.timedout) next();
          },
        });
      }
    }

    this.use({
      key: "BODY.PARSER.URLENCODED",
      handler: express.urlencoded({ limit: ctx.limit, extended: false }),
    });
    this.use({
      key: "BODY.PARSER.JSON",
      handler: express.json({ limit: ctx.limit }),
    });

    if (ctx.useCookie) {
      this.use({ key: "COOKIE.PARSER", handler: cookieParser() });
    }

    if (ctx.useFavicon) {
      this.use({
        key: "FAVICON",
        handler: favicon(path.join(ctx.appPath, "public", "favicon.ico")),
      });
    }

    this.use({
      key: "REQUEST.CONTEXT",
      handler: (req, res, next) => {
        requestStore.run({ req, ua: null }, next);
      },
    });

    this.use({ key: "REQUEST.IP", handler: requestIp.mw() });

    if (ctx.useUserAgent) {
      this.use({
        key: "REQUEST.UA",
        handler: (req, res, next) => {
          const store = requestStore.getStore();
          if (store && req.headers["user-agent"]) {
            store.ua = userAgent.parse(req.headers["user-agent"]);
          }
          next();
        },
      });
    }
  }

  // ─── 부팅 시퀀스 ──────────────────────────────────────────────────────────────

  async boot() {
    logger.debug("boot");

    await this.bootStep("INITIALIZE-CONFIG", () => this.context.config.initialize());
    await this.bootStep("CREATE-APP", () => this.createApp());
    await this.bootStep("SETUP-MIDDLEWARES", () => this.setupMiddlewares());
    await this.bootStep("LOAD-CONSTANTS", () => this.loadConstants());
    await this.bootStep("LOAD-PLUGINS", () => this.loadPlugins());
    await this.bootStep("EXECUTE-PRE-PLUGINS", () => this.executePlugins(false));
    await this.bootStep("LOAD-MIDDLEWARES", () => this.applyMiddlewares());
    await this.bootStep("LOAD-MODELS", () => this.loadModels());
    await this.bootStep("LOAD-SERVICE-MODELS", () => this.loadServiceModels());
    await this.bootStep("INITIALIZE-MODELS", () => this.initializeModels());
    await this.bootStep("LOAD-SERVICES", () => this.loadServices());
    await this.bootStep("EXECUTE-POST-PLUGINS", () => this.executePlugins(true));

    if (this.context.createDoc) {
      await this.bootStep("CREATE-SWAGGER-DOCS", () => this.createSwaggerDocs());
    }

    await this.bootStep("RUN-SERVER", () => this.startServer());

    return this;
  }

  async bootStep(name, fn) {
    logger.info(`[boot] ${name}`);
    try {
      await fn();
    } catch (e) {
      logger.error(`[boot] failed: ${name}`, e);
      throw e;
    }
  }

  createApp() {
    const app = express();

    if (this.context.useProxy) {
      app.set("trust proxy", true);
    }

    app.on("uncaughtException", this.onException);
    this.app = app;
  }

  async loadConstants() {
    const constantFiles = globSync("data/constants/*.js", {
      cwd: this.context.appPath,
    });

    for (const file of constantFiles) {
      const constant = await importFile(this.context.appPath, file);
      const key = path.basename(file, ".js").toUpperCase();

      logger.info("constant loaded", key);

      if (this.constants[key]) {
        logger.warn("constant already loaded", key);
      }

      this.constants[key] = constant;
    }
  }

  async loadPlugins() {
    const pluginFiles = globSync("plugins/*/index.js", {
      cwd: this.context.appPath,
    });

    for (const file of pluginFiles) {
      const plugin = await importFile(this.context.appPath, file);

      if (plugin.mode) {
        const enabledModes = plugin.mode.split(",");
        if (!enabledModes.includes(this.context.config.mode)) {
          logger.warn("plugin skipped (mode mismatch)", file, `required: ${plugin.mode}`);
          continue;
        }
      }

      const key = plugin.name || path.dirname(file).split("/").pop();
      logger.info("plugin loaded", key);
      this.plugins[key] = plugin;
    }
  }

  async executePlugins(deferred) {
    for (const key in this.plugins) {
      const plugin = this.plugins[key];
      if (plugin.defer === deferred) {
        try {
          logger.info("plugin executing", key);
          await plugin.execute(this);
        } catch (e) {
          logger.error("plugin failed", key, e);
        }
      }
    }
  }

  applyMiddlewares() {
    const deferredMiddlewares = [];

    for (const middleware of this.middlewares) {
      if (middleware.defer !== true) {
        logger.info("middleware applied", middleware.key);

        if (middleware.path) {
          this.app.use(middleware.path, middleware.handler);
        } else {
          this.app.use(middleware.handler);
        }
      } else {
        deferredMiddlewares.push(middleware);
      }
    }

    if (deferredMiddlewares.length > 0) {
      this.app.use((req, res, next) => {
        const cleanup = () => {
          res.removeListener("finish", cleanup);
          res.removeListener("close", cleanup);

          for (const middleware of deferredMiddlewares) {
            middleware.handler(req, res, () => {
              logger.warn("Deferred middleware does not need next().");
            });
          }
        };

        res.on("finish", cleanup);
        res.on("close", cleanup);
        next();
      });
    }
  }

  async loadModels() {
    const modelFiles = globSync("models/*/*.js", { cwd: this.context.appPath });

    for (const modelFile of modelFiles) {
      await this.registerModel(modelFile, this.context);
    }
  }

  async loadServiceModels() {
    const serviceScopes = getServiceScopes(this.context);

    const patterns =
      serviceScopes.length > 0 ? serviceScopes.map(s => `services/${s}/models/*.js`) : ["services/*/models/*.js"];

    for (const pattern of patterns) {
      const modelFiles = globSync(pattern, { cwd: this.context.appPath });
      for (const modelFile of modelFiles) {
        await this.registerModel(modelFile, this.context);
      }
    }
  }

  async registerModel(modelFile, context) {
    try {
      const modelClass = await importFile(context.appPath, modelFile);
      const key = modelClass.prototype.constructor.name.replace("Model", "");

      if (this.models[key]) {
        logger.warn("model already loaded", key);
      }

      const model = new modelClass({ context });

      this.models[key] = {
        name: key,
        constructor: modelClass,
        design: model.createDesign(),
      };

      logger.info("model loaded", key);
    } catch (e) {
      logger.error("model load failed", modelFile, e);
      throw e;
    }
  }

  async initializeModels() {
    for (const key in this.models) {
      try {
        const { design } = this.models[key];
        await design.initialize({ autoCreate: this.context.initMode });
        logger.info("model initialized", key);
      } catch (e) {
        logger.error("model init failed", key, e);
      }
    }
  }

  async loadServices() {
    const serviceScopes = getServiceScopes(this.context);

    const patterns =
      serviceScopes.length > 0 ? serviceScopes.map(s => `services/${s}/*Service.js`) : ["services/*/*Service.js"];

    for (const pattern of patterns) {
      const serviceFiles = globSync(pattern, { cwd: this.context.appPath });

      for (const file of serviceFiles) {
        try {
          const service = await importFile(this.context.appPath, file);
          if (service && service._initPromise) await service._initPromise;
          logger.info("service loaded", file);
          this.services.push(service);
        } catch (e) {
          logger.error("service load failed", file, e);
          throw e;
        }
      }
    }
  }

  async createSwaggerDocs() {
    for (const scope of this.context.scopes) {
      const scopeName = scope.toUpperCase();
      logger.info("swagger docs creating", scopeName);

      try {
        const swaggerConfig = this.context.config.get("swagger") || {};
        const templateFilename = swaggerConfig.template || "api-doc.html";
        const { swaggerPath, jsonFileName } = await createDoc(
          this.context,
          this.routes,
          this.models,
          `swag.${scope}.json`,
          scope,
        );

        const isPrimaryScope = this.context.scopes[0] === scope;

        const docDataUrl = isPrimaryScope
          ? path.join(this.context.docPath, "data")
          : path.join(this.context.docPath, `${scope}/data`);

        const docUrl = isPrimaryScope ? path.join(this.context.docPath) : path.join(this.context.docPath, scope);

        this.app.use(express.static(path.join(this.context.appPath, "public", "swagger")));

        if (isPrimaryScope) {
          this.app.get("/", (req, res) => res.redirect(docUrl));
        }

        this.app.get(docDataUrl, (req, res) => {
          res.sendFile(`data/${jsonFileName}`, { root: swaggerPath });
        });

        this.app.get(docUrl, async (req, res) => {
          try {
            const html = await renderDoc(path.join(swaggerPath, templateFilename), { data_url: docDataUrl });
            res.send(html);
          } catch (e) {
            logger.error("swagger render failed", e);
            res.status(500).send(e.message);
          }
        });
      } catch (e) {
        logger.error("swagger docs failed", scopeName, e);
      }
    }
  }

  startServer() {
    return new Promise(resolve => {
      const server = http.createServer(this.app);

      server.listen(this.context.port, () => {
        logger.info(`Server is running on port ${this.context.port}`);
        resolve();
      });

      server.on("error", this.onError);
      server.on("listening", this.onListening);

      this.server = server;
    });
  }

  // ─── 생성자 ──────────────────────────────────────────────────────────────────

  constructor(options) {
    process.framework = this;

    this.context = new AppContext({
      framework: this,
      appPath: process.cwd(),
      ...options,
    });

    this.app = null;
    this.server = null;
    this.models = {};
    this.plugins = {};
    this.constants = {};
    this.services = [];
    this.routes = [];
    this.middlewares = [];

    this.upload = multer(options.multerOptions || { storage: multer.memoryStorage() });

    logger.debug("init", {
      YS_API_MODE: process.env.YS_API_MODE,
      NODE_ENV: process.env.NODE_ENV,
      appPath: this.context.appPath,
      port: this.context.config.port,
      mode: this.context.config.mode,
    });
  }

  // ─── 공개 API ─────────────────────────────────────────────────────────────────

  model(key, connection = null) {
    const modelData = this.models[key];
    if (!modelData) return null;

    const { design } = modelData;
    const model = new modelData.constructor({ design, context: this.context });

    if (connection) {
      model.setCollection(design.createCollection(connection));
    }

    return model;
  }

  plugin(key) {
    return this.plugins[key] || null;
  }

  getConstants(key) {
    return this.constants[key.toUpperCase()] || {};
  }

  createError(message, options = {}) {
    const error = new Error(message);
    error.statusCode = options.statusCode || this.context.defaultErrorStatusCode || 500;
    error.data = options.data || {};
    return error;
  }

  use(arg, func, defer = false) {
    const autoKey = () => `MIDDLEWARE.${this.middlewares.length + 1}`;

    if (typeof arg === "string") {
      this.middlewares.push({
        key: autoKey(),
        path: arg,
        handler: func,
        defer,
      });
    } else if (typeof arg === "function") {
      this.middlewares.push({
        key: autoKey(),
        handler: arg,
        defer: typeof func === "boolean" ? func : defer,
      });
    } else if (arg && typeof arg === "object" && typeof arg.handler === "function") {
      this.middlewares.push({ key: autoKey(), defer: false, ...arg });
    }
  }

  async run() {
    logger.debug("run");
    try {
      attachExceptionHandlers();
      return await this.boot();
    } catch (e) {
      logger.error("application start failed", e);
      throw e;
    }
  }

  onListening() {
    logger.debug("listening");
  }

  onException(req, res, route, err) {
    logger.error("uncaught route exception", err);
  }

  onError(error) {
    logger.error("server error", error);
  }
}

export default Application;
