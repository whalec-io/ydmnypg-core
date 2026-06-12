import _ from "lodash";
import fs from "fs";
import path from "path";
import objectPath from "object-path";
import DAO from "@ydmnypg/data";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:config");

function findAdapter(key) {
  if (key.includes("mysql")) return "mysql";
  if (key.includes("postgresql") || key.includes("postgres")) return "postgresql";
  return "unknown";
}

function parseConfig(appPath, mode, options = {}) {
  const { config } = options;
  if (config) return config;

  const candidates = [
    path.join(appPath, "config/conf.d", `config.${mode}.json`),
    path.join(appPath, "data/config/conf.d", `config.${mode}.json`),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath));
      }
    } catch (e) {
      logger.error("parse config error", e);
    }
  }

  return {};
}

async function initializeConnections(connections, connectionOptions) {
  logger.debug("initializing DB connections");

  for (const key in connections) {
    await DAO.registerConnection(key, connections[key]);
  }

  if (connectionOptions) {
    await DAO.registerConnections(connectionOptions);
  }
}

class AppConfig {
  get host() {
    return this.config.host || "localhost";
  }

  get port() {
    return this.config.port || 9000;
  }

  get createDoc() {
    return this.config.createDoc || false;
  }

  get docPath() {
    return (this.config.swagger && this.config.swagger.docPath) || "/doc";
  }

  get database() {
    return this.config.database || {};
  }

  get(deepPath) {
    return objectPath.get(this.config, deepPath);
  }

  connection(key) {
    return DAO.connection(key);
  }

  registerConnection(key, options) {
    logger.debug("registering connection", key);

    if (!options.adapter) {
      const detected = findAdapter(key);
      if (detected === "unknown") {
        logger.warn(
          `registerConnection: adapter를 감지할 수 없습니다 (key: "${key}"). options.adapter를 명시적으로 지정하세요.`,
        );
      } else {
        logger.warn(
          `registerConnection: key 이름으로 adapter="${detected}"를 자동 감지했습니다. options.adapter를 명시적으로 지정하는 것을 권장합니다.`,
        );
        options = { adapter: detected, ...options };
      }
    }

    this.connections[key] = options;
  }

  registerConnections(connectionOptions) {
    logger.debug("registering connections");
    this.connectionOptions = connectionOptions || this.getConnectionOptionsFromConfig();
  }

  getConnectionOptionsFromConfig(options = {}) {
    const { excludesAll, includes, excludes } = options;
    const dbConfig = this.database;
    const connectionOptions = {};

    _.forEach(dbConfig, (config, key) => {
      const isIncluded = !includes || includes.includes(key);
      const isExcluded = excludes && excludes.includes(key);

      if (excludesAll ? isIncluded && !isExcluded : !isExcluded) {
        const adapter = config.adapter || findAdapter(key);
        if (adapter === "unknown") {
          logger.warn(
            `getConnectionOptionsFromConfig: "${key}" 어댑터를 알 수 없어 건너뜁니다. config에 adapter 필드를 명시하세요.`,
          );
          return;
        }
        connectionOptions[`${key}-connection`] = { adapter, ...config };
      }
    });

    return connectionOptions;
  }

  initialize() {
    return initializeConnections(this.connections, this.connectionOptions);
  }

  constructor(options) {
    logger.debug("init", { mode: options.mode });

    this.mode = options.mode;
    this.appPath = process.cwd();
    this.config = parseConfig(this.appPath, this.mode, options);
    this.connections = {};
    this.connectionOptions = null;
  }
}

export default AppConfig;
