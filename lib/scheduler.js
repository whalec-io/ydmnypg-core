import schedule from "node-schedule";
import JwtManager from "./jwt-manager.js";
import loadModules from "./module-loader.js";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:scheduler", 4);

class Scheduler {
  get config() {
    return this.service.config;
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

  generateJobs(options) {
    const { jobs } = options;

    if (!process.framework.context.useScheduler) {
      logger.info("scheduler disabled", this.constructor.name);
      return;
    }

    logger.debug("registering jobs", jobs.length);

    for (const jobOptions of jobs) {
      const { rule, timezone, start, controllers } = jobOptions;

      for (const handler of controllers) {
        const spec = {};
        if (rule) spec.rule = rule;
        if (timezone) spec.tz = timezone;

        const executeJob = async (fireDate) => {
          logger.info("job fired", this.constructor.name, fireDate);
          try {
            await handler.call(this, fireDate);
          } catch (e) {
            logger.error("job failed", this.constructor.name, e);
          }
        };

        if (start) {
          executeJob(new Date()).catch((e) =>
            logger.error("job start error", e),
          );
        }

        schedule.scheduleJob(spec, (fireDate) => {
          executeJob(fireDate).catch((e) =>
            logger.error("job schedule error", e),
          );
        });
      }
    }
  }

  generateToken(userInfo) {
    return this.jwt.generateToken(userInfo);
  }

  constructor({ service }) {
    logger.debug("init", service.name);

    this.service = service;
    this.jwt = new JwtManager(service.config.get("jwt"));
  }

  static async autoLoad(cwd, options = {}) {
    const handlers = await loadModules(cwd, {
      ...options,
      rule: options.rule || "jobs/**/*.js",
    });

    logger.debug("jobs loaded", handlers.length);
    return handlers;
  }
}

export default Scheduler;
