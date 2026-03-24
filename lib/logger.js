import Debug from "debug";

const EventLevel = {
  ALL: 1,
  DEBUG: 2,
  INFO: 3,
  LOG: 4,
  WARN: 5,
  ERROR: 6,
  FATAL: 7,
  NONE: 9,
};

const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "token",
  "secret",
  "authorization",
  "credential",
  "apikey",
  "api_key",
];

function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (!obj || typeof obj !== "object") return obj;

  const result = {};
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((k) => lowerKey.includes(k))) {
      result[key] = "***";
    } else {
      result[key] = sanitize(obj[key]);
    }
  }
  return result;
}

function resolveLogLevel(namespace) {
  const debug = process.env.DEBUG;
  if (!debug) return EventLevel.NONE;

  const levels = [
    [`${namespace}:debug`, EventLevel.DEBUG],
    [`${namespace}:info`, EventLevel.INFO],
    [`${namespace}:log`, EventLevel.LOG],
    [`${namespace}:warn`, EventLevel.WARN],
    [`${namespace}:error`, EventLevel.ERROR],
    [namespace, EventLevel.ALL],
  ];

  const match = levels.find(([key]) => debug.includes(key));
  return match ? match[1] : EventLevel.NONE;
}

class Logger {
  log(...msg) {
    if (this.logLevel <= EventLevel.LOG) {
      this.writer(...msg);
    }
  }

  debug(...msg) {
    if (this.logLevel <= EventLevel.DEBUG) {
      this.writer("DEBUG", ...msg);
    }
  }

  info(...msg) {
    if (this.logLevel <= EventLevel.INFO) {
      this.writer("INFO", ...msg);
    }
  }

  warn(...msg) {
    if (this.logLevel <= EventLevel.WARN) {
      this.writer("WARN", ...msg);
    }
  }

  error(...msg) {
    if (this.logLevel <= EventLevel.ERROR) {
      this.writer("ERROR", ...msg);
    }
  }

  requestStart(req) {
    const startTime = Date.now();
    const requestId = "R." + this.requestCount++;

    this.requestTimes[requestId] = startTime;

    if (this.logLevel <= EventLevel.INFO) {
      const params = sanitize({ ...req.query, ...req.body });
      this.info("Request", requestId, req.method, req.originalUrl, params);
    }

    return requestId;
  }

  requestEnd(requestId, action, ...msg) {
    const startTime = this.requestTimes[requestId];
    delete this.requestTimes[requestId];

    if (this.logLevel <= EventLevel.INFO && startTime !== undefined) {
      const elapsed = Date.now() - startTime;
      this.info("Response", requestId, action, ...msg, elapsed + "ms");
    }
  }

  constructor(namespace, color = 7) {
    this.logLevel = resolveLogLevel(namespace);

    this.writer = new Debug(namespace);
    this.writer.enabled = this.logLevel < EventLevel.NONE;
    this.writer.color = color;

    this.requestCount = 0;
    this.requestTimes = {};
  }
}

export default Logger;
