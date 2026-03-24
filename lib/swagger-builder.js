import _ from "lodash";
import fs from "fs";
import os from "os";
import path from "path";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:swagger");

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (!iface.internal && iface.family === "IPv4") return iface.address;
    }
  }
  return "127.0.0.1";
}

class SwaggerBuilder {
  isMultipartData(params) {
    return (params || []).some((p) => p.type === "file");
  }

  getDescription(param) {
    let desc = param.description || "No description";
    if (param.json) desc += " (JSON)";
    if (param.json || param.unsafe) desc += " ** Unsafe **";
    if (param.minLength !== undefined)
      desc += ` (minLength: ${param.minLength})`;
    if (param.maxLength !== undefined)
      desc += ` (maxLength: ${param.maxLength})`;
    if (param.min !== undefined) desc += ` (min: ${param.min})`;
    if (param.max !== undefined) desc += ` (max: ${param.max})`;
    return desc;
  }

  resolveParamLocation(route, param) {
    if (route.path.includes(":" + param.name)) return "path";
    const method = (route.method || "").toLowerCase();
    if (method === "put" || method === "post") return "formData";
    return "query";
  }

  paramInfo(param, typeIn) {
    const info = {
      name: param.name,
      in: typeIn,
      description: this.getDescription(param),
      required: param.optional !== true,
    };

    if (param.type && param.type !== "any") {
      info.type = param.type;
    }

    if (Array.isArray(param.enum)) {
      info.enum = param.enum;
    }

    if (param.format) {
      info.format = param.format;
    }

    if (param.in) {
      info.in = param.in;
    }

    if (param.items) {
      info.items = param.items;
    }

    return info;
  }

  pathInfo(route, info, scope = "") {
    const scopes = route.scopes || [];
    if (!scopes.includes(scope)) return null;

    const isMultipart = this.isMultipartData(route.params);
    const requestType = isMultipart
      ? "multipart/form-data"
      : "application/x-www-form-urlencoded";

    const parameters = (route.params || []).map((param) => {
      const typeIn = this.resolveParamLocation(route, param);
      return this.paramInfo(param, typeIn);
    });

    const pathParamNames = (route.routePath || "").match(/\{(\w+)\}/g) || [];
    for (const match of pathParamNames) {
      const name = match.replace(/\{|\}/g, "");
      if (!parameters.find((p) => p.name === name)) {
        parameters.unshift({
          name,
          in: "path",
          required: true,
          type: "string",
          description: "Path parameter",
        });
      }
    }

    const pathInfo = {
      tags: route.tags || [route.group],
      summary: route.summary || "",
      description: route.description || "No description",
      produces: ["application/json"],
      consumes: [requestType],
      parameters,
      responses: {
        200: {
          description: `A JSON result${route.resDescription ? "<br>" + route.resDescription : ""}`,
          schema: { $ref: "#/definitions/BasicResult" },
        },
        401: { description: "Unauthorized" },
        500: { description: "Internal Server Error" },
      },
    };

    if (route.permissions) {
      pathInfo.security = [{ APIKeyHeader: [] }];
    }

    info[route.method] = pathInfo;
    return info;
  }

  buildPaths(routes, scope = "") {
    const routePaths = {};
    const documentFilter = process.framework.context.documentFilter;

    for (const route of routes) {
      if (documentFilter && !documentFilter(route)) continue;

      let routePath = route.routePath || "";
      routePath = routePath.replace(/\(\\d\+\)/g, "");

      for (const param of route.params || []) {
        routePath = routePath.replace(":" + param.name, "{" + param.name + "}");
      }
      routePath = routePath.replace(/:(\w+)/g, "{$1}");

      logger.debug("routePath", routePath);

      const info = this.pathInfo(route, routePaths[routePath] || {}, scope);
      if (info) {
        routePaths[routePath] = info;
      }
    }

    return routePaths;
  }

  dbTypeToSwagger(attribute) {
    let type = "string";
    let format;
    let description = attribute.description || "";

    if (attribute.defaultValue !== undefined) {
      description += ` (Default: ${attribute.defaultValue})`;
    }

    switch (attribute.type) {
      case "string":
      case "varchar":
      case "char":
        type = "string";
        break;
      case "datetime":
      case "date":
        type = "string";
        format = attribute.type === "datetime" ? "date-time" : "date";
        break;
      case "text":
      case "longtext":
        type = attribute.json ? "object" : "string";
        break;
      case "number":
      case "double":
      case "float":
        type = "number";
        break;
      case "integer":
      case "int":
      case "bigint":
      case "smallint":
        type = "integer";
        break;
      case "boolean":
      case "bit":
      case "tinyint":
        type = "boolean";
        break;
      case "array":
      case "list":
        type = "array";
        break;
      case "uuid":
        type = "string";
        format = "uuid";
        break;
      case "json":
      case "jsonb":
        type = "object";
        break;
      default:
        type = attribute.type || "string";
    }

    const result = { type, description };
    if (format) result.format = format;
    return result;
  }

  getSchemaInfos(model) {
    const modelObjects = [];
    if (
      !model.design ||
      !model.design.schemas ||
      model.design.schemas.length === 0
    ) {
      return modelObjects;
    }

    for (const schema of model.design.schemas) {
      const properties = {};
      const required = [];

      for (const [key, attribute] of Object.entries(schema.attributes || {})) {
        if (!attribute.key) attribute.key = key;
        if (attribute.hidden === true) continue;

        attribute.key = attribute.key === "_id" ? "uid" : attribute.key;
        properties[attribute.key] = this.dbTypeToSwagger(attribute);

        if (attribute.primaryKey || attribute.notNull === true) {
          required.push(attribute.key);
        }
      }

      modelObjects.push({
        name:
          schema.default === true ? model.name : `${model.name}.${schema.name}`,
        description: schema.description || "",
        required,
        properties,
      });
    }

    return modelObjects;
  }

  buildModels(models) {
    const modelObjects = {};

    _.forEach(models, (model) => {
      for (const info of this.getSchemaInfos(model)) {
        modelObjects[info.name] = info;
      }
    });

    return modelObjects;
  }

  buildJSON(options = {}, scope = "") {
    const { routes, models } = options;
    const routePaths = this.buildPaths(routes, scope);
    const host =
      this.context.host ||
      this.config.host ||
      `${getLocalIp()}:${this.context.port}`;
    const modelObjects = this.buildModels(models, scope);

    return {
      swagger: "2.0",
      info: {
        title:
          this.config.title ||
          `${this.context.title} (${this.context.config.mode})`,
        description: "Auto created swagger api document",
        version: this.context.version || "0.0.0",
      },
      securityDefinitions: {
        APIKeyHeader: {
          type: "apiKey",
          in: "header",
          name: "x-access-token",
        },
      },
      definitions: {
        BasicResult: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["success", "error"] },
            data: { type: "object" },
            error: { type: "string" },
          },
        },
        ...modelObjects,
      },
      host,
      basePath: "/",
      schemes: this.config.schemes || ["http", "https"],
      paths: routePaths,
    };
  }

  async jsonWriteAsync(filePath, json) {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(json, null, 2),
      "utf8",
    );
    logger.info(`swagger json created: ${filePath}`);
  }

  constructor(context) {
    this.context = context;
    this.config = context.config.get("swagger") || {};
  }
}

export default SwaggerBuilder;
