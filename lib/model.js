import _ from "lodash";
import DAO from "@ydmnypg/data";
import objectPath from "object-path";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:model", 6);

class Model {
  get design() {
    return { type: "unset" };
  }

  get connection() {
    return this.collection ? this.collection.connection : null;
  }

  get db() {
    if (this.dao) return this.dao.db;
    if (this.collection) return this.collection.db;
    return null;
  }

  get config() {
    return this.context.config;
  }

  initData() {
    const key = `$model:${this.constructor.name}`;
    const existing = this.context.getItem(key);
    if (!existing) {
      this.context.setItem(key, this.defaultData() || {});
    }
    return this.context.getItem(key);
  }

  defaultData() {
    return {};
  }

  createDesign() {
    const designConfig = this.design;
    logger.debug("createDesign", this.constructor.name, {
      type: designConfig.type,
      dbConnection: designConfig.dbConnection || "none",
    });

    if (designConfig && designConfig.type !== "unset") {
      this.dao = new DAO.Design(designConfig);
    }

    return this.dao;
  }

  setCollection(col) {
    if (
      this.design.dbConnection !== (col.dbConnection && col.dbConnection.key)
    ) {
      logger.warn(
        "connection mismatch",
        this.design.dbConnection,
        col.dbConnection && col.dbConnection.key,
      );
      return;
    }
    this.collection = col;
  }

  setConnection(connection) {
    if (this.dao) {
      const col = this.dao.createCollection(connection);
      this.setCollection(col);
    }
  }

  initialize() {
    logger.debug("schema initialize");
    if (this.dao) {
      return this.dao.initialize({ autoCreate: this.context.initMode });
    }
    return false;
  }

  constants(key) {
    return process.framework.getConstants(key);
  }

  schema(name) {
    const schema = process.framework.getConstants("SCHEMA");
    return objectPath.get(schema, name);
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

  defaultTable() {
    const db = this.db;
    if (!db) return null;
    if (this.dao && this.dao.defaultSchema && this.dao.defaultSchema.name) {
      return db.table(this.dao.defaultSchema.name);
    }
    return db.table ? db.table() : null;
  }

  filterData(origin, options = {}) {
    if (!origin) return origin;

    let res;
    try {
      res = options.excludesAll === true ? {} : structuredClone(origin);
    } catch {
      res =
        options.excludesAll === true ? {} : JSON.parse(JSON.stringify(origin));
    }

    if (options.includes && _.isObject(options.includes)) {
      for (const [key, value] of Object.entries(options.includes)) {
        res[key] = typeof value === "function" ? value(origin) : value;
      }
    }

    if (options.mapKeys && _.isObject(options.mapKeys)) {
      res = _.mapKeys(res, (_value, key) => options.mapKeys[key] || key);
    }

    if (options.excludeNull) {
      for (const key of Object.keys(res)) {
        if (res[key] === null) delete res[key];
      }
    }

    if (Array.isArray(options.excludes)) {
      for (const key of options.excludes) {
        delete res[key];
      }
    }

    if (options.sortKeys) {
      return Object.fromEntries(
        Object.entries(res).sort(([a], [b]) => a.localeCompare(b)),
      );
    }

    return { ...res };
  }

  findOne(res, defaultValue = null) {
    return res && res.length > 0 ? res[0] : defaultValue;
  }

  getTotal(res, field = "total", defaultValue = 0) {
    return res && res.length > 0 ? res[0][field] : defaultValue;
  }

  constructor({ collection, design, context }) {
    logger.debug("init", this.constructor.name);

    this.collection = collection || null;
    this.dao = design || null;
    this.context = context;
    this.$data = this.initData();
  }

  #parseDbArgs(modelsOrCallback, callback) {
    if (typeof modelsOrCallback === "function") {
      return { models: [], fn: modelsOrCallback };
    }
    const models = Array.isArray(modelsOrCallback)
      ? modelsOrCallback
      : [modelsOrCallback];
    return { models, fn: callback };
  }

  async withDb(modelsOrCallback, callback) {
    const { models, fn } = this.#parseDbArgs(modelsOrCallback, callback);

    if (!this.db) {
      logger.error("withDb failed", {
        model: this.constructor.name,
        hasDao: !!this.dao,
        hasCollection: !!this.collection,
        daoDb: this.dao ? !!this.dao.db : false,
        daoDbConnection: this.dao ? !!this.dao.dbConnection : false,
      });
      throw new Error(
        `withDb: DB connection not found (${this.constructor.name})`,
      );
    }

    return this.db.task(async (connection) => {
      this.setConnection(connection);
      for (const model of models) model.setConnection(connection);
      return fn(connection);
    });
  }

  async withTransaction(modelsOrCallback, callback) {
    const { models, fn } = this.#parseDbArgs(modelsOrCallback, callback);

    if (!this.db) {
      throw new Error(
        `withTransaction: DB connection not found (${this.constructor.name})`,
      );
    }

    return this.db.transaction(async (connection) => {
      this.setConnection(connection);
      for (const model of models) model.setConnection(connection);
      return fn(connection);
    });
  }

  static dbConnection(connectionName) {
    return DAO.connection(connectionName);
  }

  static get prefix() {
    return process.framework.context.prefix;
  }
}

export default Model;
