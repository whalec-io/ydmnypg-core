import _ from "lodash";
import fs from "fs";
import path from "path";
import xml from "xml2js";
import mime from "mime-types";
import mustache from "mustache";
import ParamValidator from "./param-validator.js";
import JwtManager from "./jwt-manager.js";
import loadModules from "./module-loader.js";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:controller", 2);

class Controller {
  get config() {
    return this.service.config;
  }

  get contentType() {
    return this.service.contentType;
  }

  constants(key) {
    return process.framework.getConstants(key);
  }

  model(key, connection = null) {
    return process.framework.model(key, connection);
  }

  plugin(key) {
    return process.framework.plugin(key);
  }

  createError(message, options = {}) {
    return process.framework.createError(message, options);
  }

  verifyParams(request, fields, errorFields = []) {
    return ParamValidator.verify(request, fields, errorFields);
  }

  checkParams(request, response, params, next) {
    logger.debug("checkParams", params.length);

    const invalidParams = [];
    if (!this.verifyParams(request, params, invalidParams)) {
      return this.onError(
        response,
        this.createError("INSUFFICIENT_PARAMS", {
          statusCode: this.service.context.defaultErrorStatusCode,
        }),
        { "invalid-params": invalidParams.join(",") },
      );
    }

    next();
  }

  checkFileParams(request, response, params, next) {
    const fields = (params || [])
      .filter(p => p && p.type === "file")
      .map(p => ({ name: p.name, maxCount: p.maxCount || 1 }));

    if (fields.length > 0) {
      return process.framework.upload.fields(fields).call(this, request, response, next);
    }

    next();
  }

  generateToken(userInfo, configOption = {}) {
    return this.jwt.generateToken(userInfo, configOption);
  }

  async checkToken(request, response, refresh, next) {
    const token = this.jwt.extractToken(request, this.config, this.config.mode);
    logger.debug("checkToken", { hasToken: !!token, refresh });

    if (!token) {
      return this.onUnauthorized(response);
    }

    request.token = token;

    const result = await this.jwt.verifyToken(token, refresh);

    if (result.error || !result.isValid) {
      return this.onUnauthorized(response, result.error?.message || "INVALID_TOKEN");
    }

    if (!result.userInfo) {
      return this.onUnauthorized(response);
    }

    if (result.newToken) {
      request.newToken = result.newToken;
    }

    request.userInfo = result.userInfo;

    if (this.session) {
      await this.session.validSession(request, response, next);
    } else {
      next();
    }
  }

  async parseToken(request, response, next) {
    const token = this.jwt.extractToken(request, this.config, this.config.mode);
    logger.debug("parseToken", !!token);

    if (token) {
      request.token = token;
      const result = await this.jwt.verifyToken(token, false);
      request.userInfo = result.userInfo || {};
    } else {
      request.userInfo = {};
    }

    next();
  }

  parseDeviceInfo(request, response, next) {
    if (request.headers["x-device-info"]) {
      try {
        request.deviceInfo = JSON.parse(decodeURIComponent(request.headers["x-device-info"]));
      } catch {
        request.deviceInfo = {};
      }
    } else {
      request.deviceInfo = {};
    }
    next();
  }

  generateRouters(options) {
    const { router, service, routers } = options;

    for (const routerOption of routers) {
      const { controllers, params, permissions, responseOptions } = routerOption;
      const routePath = routerOption.path;
      const method = (routerOption.method && routerOption.method.toLowerCase()) || "get";

      if (!router[method] || !["get", "post", "put", "delete"].includes(method)) {
        throw new Error(`invalid method: ${routePath}`);
      }

      if (!controllers || controllers.length === 0 || typeof controllers[0] !== "function") {
        throw new Error(`invalid controller: ${routePath} method ${method}`);
      }

      const middlewares = [
        (request, response, next) => {
          request.requestId = logger.requestStart(request);
          next();
        },
      ];

      if (routerOption.contentType) {
        const contentType = mime.contentType(routerOption.contentType);
        if (contentType) {
          middlewares.push((request, response, next) => {
            const lower = contentType.toLowerCase();
            if (lower.includes("json")) {
              response.set("content-type", "application/json; charset=utf-8");
            } else if (lower.includes("xml")) {
              response.set("content-type", "application/xml; charset=utf-8");
            } else if (lower.includes("html")) {
              response.set("content-type", "text/html; charset=utf-8");
            } else if (lower.includes("text")) {
              response.set("content-type", "text/plain; charset=utf-8");
            } else {
              response.set("content-type", contentType);
            }
            next();
          });
        }
      }

      if (params) {
        middlewares.push((request, response, next) => {
          this.checkFileParams(request, response, params, next);
        });
        middlewares.push((request, response, next) => {
          this.checkParams(request, response, params, next);
        });
      }

      if (permissions) {
        middlewares.push((request, response, next) => {
          request.permissions = permissions;
          next();
        });

        if (permissions.includes("token") || permissions.includes("admin")) {
          middlewares.push((request, response, next) => {
            this.checkToken(request, response, permissions.includes("refresh"), next);
          });
        } else {
          middlewares.push((request, response, next) => {
            this.parseToken(request, response, next);
          });
        }

        if (permissions.includes("device")) {
          middlewares.push((request, response, next) => {
            this.parseDeviceInfo(request, response, next);
          });
        }
      }

      const handlers = controllers.map(handler => {
        return async (request, response, next) => {
          try {
            const result = await handler.call(this, request, response, next);

            if (typeof result === "undefined" || typeof result === "number") {
              return this.onStatus(response, result);
            }

            if (responseOptions && responseOptions.custom) {
              return this.onCustom(response, result);
            }

            return this.onSuccess(response, result);
          } catch (e) {
            return this.onError(response, e, e.data || {});
          }
        };
      });

      const args = [path.join(options.path || "", routePath), ...middlewares, ...handlers];
      router[method].apply(router, args);

      routerOption.routePath = path.join(this.service.path, options.path || "", routePath);
      routerOption.group = this.service.name;
      routerOption.scopes = _.uniq([...(this.scopes || this.defaultScopes()), ...(routerOption.scopes || [])]);
      routerOption.tags = _.uniq([
        ...(this.tags || []),
        ...(this.group ? [this.group] : []),
        ...(routerOption.tags || []),
      ]);

      process.framework.routes.push(routerOption);
    }

    logger.debug("routes registered", process.framework.routes.length);
  }

  defaultScopes() {
    const tags = this.tags || [];
    const contextScopes = this.service.context.scopes;

    for (const scope of contextScopes) {
      if (tags.includes(scope)) {
        return [scope];
      }
    }

    return [contextScopes[0]];
  }

  resolveContentType(response) {
    const contentType = (response.get("Content-Type") || this.contentType).toLowerCase();
    if (contentType.includes("json")) return "json";
    if (contentType.includes("xml")) return "xml";
    return contentType;
  }

  send(response, { statusCode, contentType, data }) {
    if (response.headersSent) {
      logger.error("response already sent");
      return;
    }

    data = data || {};

    if (this.service.context.useSendData) {
      response._sendData = data;
    }

    if (statusCode) {
      response.status(statusCode);
    }

    if (contentType === "json") {
      response.set("content-type", "application/json; charset=utf-8");
      response.json(data);
    } else if (contentType === "xml") {
      const xmlObject = this.xmlBuilder.buildObject(data);
      response.set("content-type", "application/xml; charset=utf-8");
      response.send(xmlObject);
    } else {
      response.set("content-type", contentType);
      response.send(data);
    }
  }

  onSuccess(response, data) {
    this.send(response, {
      statusCode: 200,
      contentType: this.resolveContentType(response),
      data: { status: "success", data },
    });

    return logger.requestEnd(response.req.requestId, "success");
  }

  onError(response, error, data) {
    logger.debug("error response", error?.message || error);

    const defaultStatusCode = this.service.context.defaultErrorStatusCode;
    const statusCode = typeof error === "object" ? error.statusCode || defaultStatusCode : defaultStatusCode;
    const errorMessage = typeof error === "string" ? error : _.isError(error) ? error.message : error.toString();

    this.send(response, {
      statusCode: statusCode || defaultStatusCode,
      contentType: this.resolveContentType(response),
      data: { status: "error", error: errorMessage, data: data || {} },
    });

    return logger.requestEnd(response.req.requestId, "error", error);
  }

  onCustom(response, data) {
    this.send(response, {
      statusCode: 200,
      contentType: this.resolveContentType(response),
      data,
    });

    return logger.requestEnd(response.req.requestId, "custom");
  }

  onUnauthorized(response, errorMessage = "Unauthorized Error") {
    return this.onError(response, this.createError(errorMessage, { statusCode: 401 }), {});
  }

  onStatus(response, status) {
    logger.debug("status response", status);
    return logger.requestEnd(response.req.requestId, "status");
  }

  jsonResponse(response, data, statusCode = 200) {
    this.send(response, { statusCode, contentType: "json", data });
  }

  xmlResponse(response, data, statusCode = 200) {
    this.send(response, { statusCode, contentType: "xml", data });
  }

  async renderTemplate(filePath, data = {}) {
    const content = await fs.promises.readFile(filePath, "utf8");
    return mustache.render(content, data);
  }

  constructor({ service }) {
    logger.debug("init", service.name);

    this.service = service;
    this.group = service.name;
    this.jwt = new JwtManager(service.config.get("jwt"));
    this.session = service.context.session || null;

    this.xmlBuilder = new xml.Builder({
      renderOpts: { pretty: true },
      cdata: true,
    });

    const prototype = this.constructor.prototype;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name.startsWith("on") && typeof prototype[name] === "function") {
        this[name] = this[name].bind(this);
      }
    }
  }

  static async autoLoad(cwd, options = {}) {
    const modules = await loadModules(cwd, {
      ...options,
      rule: options.rule || "handlers/**/*.js",
    });

    const priorityHandlers = { high: [], medium: [], low: [] };

    for (const handler of modules) {
      if (handler.priority === "high") {
        priorityHandlers.high.push(handler);
      } else if (handler.priority === "low" || handler.defer === true) {
        priorityHandlers.low.push(handler);
      } else {
        priorityHandlers.medium.push(handler);
      }
    }

    // Within each priority bucket, register static paths (no `:` params) before
    // dynamic ones so /foo/bar matches before /foo/:id. Array#sort is stable, so
    // existing order is preserved among same-kind paths.
    const isStatic = h => !(h?.path || "").includes(":");
    const staticFirst = (a, b) => Number(isStatic(b)) - Number(isStatic(a));
    priorityHandlers.high.sort(staticFirst);
    priorityHandlers.medium.sort(staticFirst);
    priorityHandlers.low.sort(staticFirst);

    return [...priorityHandlers.high, ...priorityHandlers.medium, ...priorityHandlers.low];
  }
}

export default Controller;
