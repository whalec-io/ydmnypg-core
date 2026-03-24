import jwt from "jsonwebtoken";
import Logger from "./logger.js";
const logger = new Logger("ydmnypg:jwt");

function resolveAuthConfig(config) {
  const raw = config || {};

  const secret = process.env.JWT_SECRET || raw.tokenSecret;
  if (!secret) {
    logger.warn(
      "JWT secret이 안전하지 않습니다. JWT_SECRET 환경변수 또는 config.jwt.tokenSecret을 설정하세요.",
    );
  }

  return {
    tokenSecret: secret || "default-unsafe-secret",
    tokenAlgorithm: raw.tokenAlgorithm || "HS256",
    expiresTokenIn: raw.expiresTokenIn || 60 * 60 * 24 * 7,
    refreshTokenIn: raw.refreshTokenIn || 60 * 60 * 24 * 2,
  };
}

class JwtManager {
  generateToken(userInfo, configOption = {}) {
    const config = { ...this.authConfig, ...configOption };
    logger.debug("generateToken", userInfo);

    return jwt.sign(userInfo, config.tokenSecret, {
      algorithm: config.tokenAlgorithm,
      expiresIn: config.expiresTokenIn,
    });
  }

  async verifyToken(token, refresh = false) {
    const config = this.authConfig;

    let decode;
    try {
      decode = await new Promise((resolve, reject) => {
        jwt.verify(token, config.tokenSecret, (err, payload) => {
          if (err) reject(err);
          else resolve(payload);
        });
      });
    } catch (err) {
      const message =
        err.message === "jwt malformed" ? "Invalid Token" : err.message;
      return { isValid: false, error: new Error(message) };
    }

    if (refresh) {
      const remaining = decode.exp * 1000 - Date.now();
      const threshold = (config.expiresTokenIn - config.refreshTokenIn) * 1000;

      if (remaining < threshold) {
        const { exp, iat, ...userInfo } = decode;
        const newToken = this.generateToken(userInfo);
        return { isValid: true, newToken, userInfo };
      }
    }

    return { isValid: true, userInfo: decode };
  }

  extractToken(request, config, mode) {
    const jwtConfig = config.get("jwt") || {};

    if (jwtConfig.headerKey && request.headers[jwtConfig.headerKey]) {
      return request.headers[jwtConfig.headerKey];
    }

    const authorization = request.headers["authorization"];
    if (typeof authorization === "string") {
      const matches = authorization.match(/(\S+)\s+(\S+)/);
      if (matches && matches[1].toLowerCase() === "bearer") {
        return matches[2];
      }
    }

    if (request.headers["x-access-token"]) {
      return request.headers["x-access-token"];
    }

    if (mode !== "production" && jwtConfig) {
      const permissions = request.permissions || [];
      if (permissions.includes("admin") && jwtConfig.testAdminToken) {
        return jwtConfig.testAdminToken;
      }
      if (jwtConfig.testToken) {
        return jwtConfig.testToken;
      }
    }

    return null;
  }

  constructor(config) {
    this.authConfig = resolveAuthConfig(config);
  }
}

export default JwtManager;
