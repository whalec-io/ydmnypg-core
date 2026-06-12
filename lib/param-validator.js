import Logger from "./logger.js";
const logger = new Logger("ydmnypg:param-validator");

function is(type, value, strict = false) {
  if (value === null || value === undefined) return false;

  switch (type) {
    case "string":
      return strict ? typeof value === "string" || typeof value === "number" : typeof value === "string";
    case "number":
      return strict ? !isNaN(Number(value)) : typeof value === "number";
    case "array":
      if (Array.isArray(value)) return true;
      if (strict && typeof value === "string") {
        try {
          return Array.isArray(JSON.parse(value));
        } catch {
          return false;
        }
      }
      return false;
    case "object":
      if (typeof value === "object" && !Array.isArray(value)) return true;
      if (strict && typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return typeof parsed === "object" && !Array.isArray(parsed);
        } catch {
          return false;
        }
      }
      return false;
    case "json":
      if (typeof value === "object") return true;
      if (typeof value === "string") {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    default:
      return false;
  }
}

function getBool(value) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return Boolean(value);
}

function parseJSON(value, defaultValue = {}) {
  if (typeof value === "object" && value !== null) return value;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

class ParamValidator {
  static verify(request, fields, errorFields = []) {
    const params = request.params || {};

    logger.debug("verifying params", fields.length);

    for (const field of fields) {
      if (typeof field === "string") {
        const param = ParamValidator.extractParam(request, field);
        if (param === undefined) {
          errorFields.push(field);
        }
        params[field] = param;
        continue;
      }

      const { name, type } = field;
      let param = ParamValidator.extractParam(request, name);
      const isEmpty = param === undefined || param === null || param === "";

      if (isEmpty) {
        if (field.optional !== true) {
          errorFields.push(name);
        }
        params[name] = param;
        continue;
      }

      const typeError = ParamValidator.checkType(field, param);
      if (typeError) {
        logger.warn("invalid param type", { name, type: typeof param });
        errorFields.push(name);
        params[name] = param;
        continue;
      }

      const ruleError = ParamValidator.checkRules(field, param);
      if (ruleError) {
        logger.warn("param rule error", name, ruleError);
        errorFields.push(name);
        params[name] = param;
        continue;
      }

      // 타입 변환
      if (type === "boolean") {
        param = getBool(param);
      } else if (field.json) {
        param = parseJSON(param, type === "array" ? [] : {});
      } else if ((type === "number" || type === "integer") && typeof param === "string") {
        param = type === "integer" ? parseInt(param, 10) : Number(param);
      }

      params[name] = param;
    }

    request.fields = fields;
    request.params = params;

    logger.debug("invalid fields", errorFields);
    return errorFields.length === 0;
  }

  static extractParam(request, name) {
    if (request.params && request.params[name] !== undefined) {
      return request.params[name];
    }

    const method = (request.method || "").toUpperCase();
    if (method === "GET" || method === "DELETE") {
      if (request.query && request.query[name] !== undefined) {
        return request.query[name];
      }
    } else {
      if (request.body && request.body[name] !== undefined) {
        return request.body[name];
      }
      if (request.files && request.files[name] !== undefined) {
        return request.files[name];
      }
    }

    return undefined;
  }

  static checkType(field, param) {
    const { type } = field;

    switch (type) {
      case "string":
        if (!is(field.json ? "json" : "string", param, true)) return "invalid string";
        break;
      case "integer":
        if (!is("number", param, true) || !Number.isInteger(Number(param))) return "invalid integer";
        break;
      case "number":
        if (!is("number", param, true)) return "invalid number";
        break;
      case "array":
        if (!is("array", param, true)) return "invalid array";
        break;
      case "object":
        if (!is("object", param, true)) return "invalid object";
        break;
      case "boolean":
      case "file":
        break;
      default:
      case "any":
        if (field.json && !is("json", param, true)) return "invalid json";
        break;
    }

    return null;
  }

  static checkRules(field, param) {
    // enum 검증 (실제 값 비교)
    if (Array.isArray(field.enum) && field.enum.length > 0) {
      if (!field.enum.includes(param)) {
        return `value must be one of [${field.enum.join(", ")}]`;
      }
    }

    // 문자열 길이
    if (typeof param === "string") {
      if (field.minLength !== undefined && param.length < field.minLength) {
        return `minLength ${field.minLength} required`;
      }
      if (field.maxLength !== undefined && param.length > field.maxLength) {
        return `maxLength ${field.maxLength} exceeded`;
      }
    }

    // 숫자 범위
    const num = Number(param);
    if (!isNaN(num)) {
      if (field.min !== undefined && num < field.min) {
        return `min value is ${field.min}`;
      }
      if (field.max !== undefined && num > field.max) {
        return `max value is ${field.max}`;
      }
    }

    // 정규식 패턴
    if (field.pattern instanceof RegExp) {
      if (!field.pattern.test(String(param))) {
        return `pattern mismatch`;
      }
    }

    // 커스텀 validator
    if (typeof field.validator === "function") {
      try {
        const result = field.validator(param);
        if (result instanceof Error) return result.message;
        if (typeof result === "string") return result;
        if (result === false) return "custom validation failed";
      } catch (e) {
        return e.message || "custom validation failed";
      }
    }

    return null;
  }
}

export default ParamValidator;
