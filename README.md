# @ydmnypg/core

A lightweight, convention-based REST API framework built on Express.js.

## Installation

```bash
npm install @ydmnypg/core
```

## Quick Start

```js
import Core from "@ydmnypg/core";

const config = new Core.AppConfig({
  mode: process.env.YS_API_MODE || process.env.NODE_ENV || "local",
});

config.registerConnections(config.getConnectionOptionsFromConfig());

const app = new Core.Application({
  config,
  path: "/",
  target: "api",
  prefix: "myapp",
  title: "My API",
  createDoc: process.env.YS_API_MODE !== "production",
  initMode: process.env.YS_API_MODE === "local",
  useCookie: true,
  useProxy: true,
});

app.run().catch(e => {
  console.error(e);
  process.exit(1);
});
```

## Project Structure

```
project/
├── bin/
│   └── worker.js              # Entry point
├── data/
│   ├── config/
│   │   ├── config.js           # AppConfig initialization
│   │   └── conf.d/
│   │       ├── config.local.json
│   │       ├── config.dev.json
│   │       ├── config.staging.json
│   │       └── config.production.json
│   └── constants/
│       └── error.js
├── services/
│   └── <service>/
│       ├── <Service>Service.js
│       ├── api/
│       │   ├── <Service>Controller.js
│       │   └── handlers/
│       ├── admin/
│       │   ├── Admin<Service>Controller.js
│       │   └── handlers/
│       └── models/
│           ├── <Model>Model.js
│           └── mappers/*.xml
├── env/
│   ├── nodemon.local.json
│   ├── nodemon.dev.json
│   ├── nodemon.staging.json
│   └── nodemon.prod.json
└── public/
    └── swagger/
```

## Configuration

### Environment Modes

| Mode         | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| `local`      | Local development with auto-create tables and debug logging |
| `dev`        | Development server                                          |
| `staging`    | Staging environment                                         |
| `production` | Production environment                                      |

Set the mode via `YS_API_MODE` environment variable or `NODE_ENV`.

### Config File (`conf.d/config.{mode}.json`)

```json
{
  "host": { "api": "http://localhost:9000" },
  "port": { "api": 9000 },
  "swagger": { "template": "api-doc.html", "schemes": ["http"] },
  "jwt": {
    "tokenSecret": "your-secret",
    "tokenAlgorithm": "HS256",
    "expiresTokenIn": 6048000,
    "refreshTokenIn": 172800
  },
  "database": {
    "mysql": {
      "host": "localhost",
      "port": 3306,
      "user": "root",
      "password": "",
      "database": "mydb"
    }
  }
}
```

## Application Options

| Option           | Type              | Default            | Description                                       |
| ---------------- | ----------------- | ------------------ | ------------------------------------------------- |
| `config`         | `AppConfig`       | required           | Configuration instance                            |
| `path`           | `string`          | `''`               | Base URL path                                     |
| `target`         | `string`          | —                  | Target name (used for host/port lookup in config) |
| `prefix`         | `string`          | `'ys'`             | Table name prefix                                 |
| `title`          | `string`          | `'API'`            | API title (shown in swagger docs)                 |
| `createDoc`      | `boolean`         | `false`            | Generate Swagger documentation                    |
| `initMode`       | `boolean`         | `false`            | Auto-create database tables on boot               |
| `useScheduler`   | `boolean`         | `false`            | Enable job scheduler                              |
| `useCookie`      | `boolean`         | `false`            | Enable cookie parser                              |
| `useProxy`       | `boolean`         | `false`            | Trust proxy headers                               |
| `useCompression` | `boolean`         | `false`            | Enable response compression                       |
| `useHttpLogger`  | `boolean\|string` | `false`            | Enable HTTP request logging (morgan)              |
| `useUserAgent`   | `boolean`         | `false`            | Parse User-Agent header                           |
| `rateLimit`      | `object\|false`   | `false`            | Rate limiting options                             |
| `timeout`        | `string\|false`   | `false`            | Request timeout                                   |
| `session`        | `object\|null`    | `null`             | Session middleware                                |
| `scopes`         | `string[]`        | `['api', 'admin']` | Router scopes                                     |

## Controller

```js
import Core from "@ydmnypg/core";

class UserController extends Core.Controller {
  constructor(service) {
    super({ service });
    this.scopes = ["api"];
    this.tags = ["user"];
  }

  static routers() {
    return this.autoLoad(__dirname, { excludes: [] });
  }
}
```

## Handler

```js
const handler = async function (request) {
  const $User = this.model("User");

  return $User.withDb(async () => {
    const items = await $User.getItems({ page: 0, size: 20 });
    const total = await $User.count();
    return { items: $User.mapItems(items), total };
  });
};

export default {
  method: "get",
  path: "/users",
  permissions: ["token"],
  params: [
    { name: "page", type: "integer", optional: true },
    { name: "size", type: "integer", optional: true },
  ],
  controllers: [handler],
};
```

### Permissions

| Permission        | Behavior                                                           |
| ----------------- | ------------------------------------------------------------------ |
| `token`           | Requires valid JWT token                                           |
| `admin`           | Requires valid JWT token (uses `testAdminToken` in non-production) |
| `refresh`         | Enables token auto-refresh                                         |
| `device`          | Parses `x-device-info` header                                      |
| _(none of above)_ | Token is parsed if present but not required                        |

## Model

```js
import Core from "@ydmnypg/core";

class UserModel extends Core.Model {
  get design() {
    return {
      type: "mysql",
      dbConnection: "mysql-connection",
      mappers: [path.join(__dirname, "mappers/user.xml")],
      schema: {
        name: `${Core.Model.prefix}_user`,
        mappingName: "TABLE_USER",
        default: true,
        attributes: {
          id: { type: "int", length: 11, autoIncrement: true, primaryKey: true },
          name: { type: "varchar", length: 100, notNull: true },
          created_at: { type: "datetime", notNull: true, defaultValue: "CURRENT_TIMESTAMP" },
          updated_at: { type: "datetime", notNull: true, defaultOnUpdate: true },
        },
      },
    };
  }

  async getItems(options = {}) {
    return this.defaultTable().execute("user.findAll", options, this.connection);
  }
}
```

### Model Methods

| Method                           | Description                                  |
| -------------------------------- | -------------------------------------------- |
| `withDb(callback)`               | Execute callback with a pooled DB connection |
| `withDb(models, callback)`       | Share connection across multiple models      |
| `withTransaction(callback)`      | Execute callback within a transaction        |
| `defaultTable()`                 | Get the default table adapter                |
| `filterData(origin, options)`    | Filter/transform data objects                |
| `findOne(rows, default)`         | Return first row or default                  |
| `getTotal(rows, field, default)` | Extract total count from result              |

## Debug Logging

Uses the [debug](https://www.npmjs.com/package/debug) module. Enable via the `DEBUG` environment variable:

```bash
# All framework logs
DEBUG=ydmnypg:*

# Specific modules
DEBUG=ydmnypg:application:debug,ydmnypg:controller:debug,ydmnypg:model:debug

# With database query logging
DEBUG=ydmnypg:*:debug,dao:mysql:debug
```

## Exports

```js
import {
  Application,
  AppConfig,
  AppContext,
  Controller,
  Model,
  Service,
  Scheduler,
  SwaggerBuilder,
  ParamValidator,
  JwtManager,
  Paging,
} from "@ydmnypg/core";
```

## License

MIT
