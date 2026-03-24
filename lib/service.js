import fs from "fs";
import path from "path";
import express from "express";
import { pathToFileURL } from "url";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:service", 3);

async function importFile(dir, file) {
  const filePath = path.resolve(dir, file + ".js");
  if (!fs.existsSync(filePath)) return null;
  const mod = await import(pathToFileURL(filePath).href);
  return mod.default ?? mod;
}

function ucfirst(name) {
  if (typeof name !== "string") return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function loadRouter(scope, options) {
  const { router, service } = options;
  const dirName = service.dir;
  const name = ucfirst(service.name);

  if (scope.startsWith("admin")) {
    const AdminController = await importFile(
      path.resolve(dirName, scope),
      `Admin${name}Controller`,
    );
    if (AdminController) {
      const ctrl = new AdminController(service);
      ctrl.generateRouters({
        path: "/admin",
        router,
        service,
        routers: await AdminController.routers(ctrl),
      });
    }

    const AdminScheduler = await importFile(
      path.resolve(dirName, scope),
      `Admin${name}Scheduler`,
    );
    if (AdminScheduler) {
      const sched = new AdminScheduler(service);
      sched.generateJobs({ service, jobs: await AdminScheduler.jobs(sched) });
    }
  } else if (scope.startsWith("scheduler")) {
    const Scheduler = await importFile(
      path.resolve(dirName, scope),
      `${name}Scheduler`,
    );
    if (Scheduler) {
      const sched = new Scheduler(service);
      sched.generateJobs({ service, jobs: await Scheduler.jobs(sched) });
    }
  } else {
    const Controller = await importFile(
      path.resolve(dirName, scope),
      `${name}Controller`,
    );
    if (Controller) {
      const ctrl = new Controller(service);
      ctrl.generateRouters({
        path: "/",
        router,
        service,
        routers: await Controller.routers(ctrl),
      });
    }

    const Scheduler = await importFile(
      path.resolve(dirName, scope),
      `${name}Scheduler`,
    );
    if (Scheduler) {
      const sched = new Scheduler(service);
      sched.generateJobs({ service, jobs: await Scheduler.jobs(sched) });
    }
  }
}

async function defaultRouter(options) {
  const { router, service } = options;

  if (service.scopes && service.scopes.length > 0) {
    for (const scope of service.scopes) {
      await loadRouter(scope, options);
    }
  }

  return router;
}

class Service {
  get path() {
    if (this.type === "api") {
      if (this.context.path) {
        return (
          "/" +
          [this.context.path, this.interfaceVersion, this.basePath].join("/")
        );
      }
      return "/" + [this.interfaceVersion, this.basePath].join("/");
    }

    if (this.context.path) {
      return "/" + [this.context.path, this.basePath].join("/");
    }

    return "/" + this.basePath;
  }

  get defaultContentType() {
    return "application/json";
  }

  normalizePath(val) {
    if (val && val.startsWith("/")) {
      return val.slice(1);
    }
    return val;
  }

  getScopes(scopes) {
    return this.context.getScopes(scopes);
  }

  constructor(name, options) {
    const {
      type,
      config,
      router,
      path,
      dir,
      dirname,
      scopes,
      contentType,
      interfaceVersion,
      main,
    } = options;

    this.type = type || "api";
    this.context = process.framework.context;
    this.config = config || this.context.config;
    this.name = name || "";
    this.dir = dir || dirname || "";
    this.scopes = scopes ? this.getScopes(scopes) : this.context.scopes;
    this.basePath = this.normalizePath(path || this.name);
    this.contentType = contentType || this.defaultContentType;
    this.interfaceVersion =
      interfaceVersion || this.context.interfaceVersion || "v1";
    this.main = main === true;

    let resolvedRouter = router;
    if (!resolvedRouter && this.dir) {
      resolvedRouter = defaultRouter;
    }

    const expressRouter = express.Router({ strict: true });
    this.router = expressRouter;
    process.framework.app.use(this.path, this.router);

    if (typeof resolvedRouter === "function") {
      this._initPromise = resolvedRouter({
        type: this.type,
        app: process.framework.app,
        router: expressRouter,
        service: this,
      });
    } else {
      this._initPromise = Promise.resolve();
    }

    logger.info("router registered", {
      type: this.type,
      name: this.name,
      basePath: this.path,
      contentType: this.contentType,
    });
  }
}

export default Service;
