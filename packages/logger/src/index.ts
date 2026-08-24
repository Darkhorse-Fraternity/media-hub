import pino from "pino";

/**
 * Logger context for structured logging with Grafana Loki support
 *
 * Low-cardinality fields (suitable as Loki labels):
 * - service: Service name (api/expo/nextjs)
 * - environment: Environment identifier (dev/staging/prod)
 * - code: Business/error code for filtering specific issues
 * - module: Module name (auth/plan/reward/task)
 * - source: Request source (web/mobile/api/internal)
 *
 * High-cardinality fields (indexed but not as labels):
 * - trace_id: Request trace ID for distributed tracing
 * - request_id: Unique request identifier
 * - user_id: User identifier (optional, consider privacy)
 */
export interface LogContext {
  // Low-cardinality labels (for Loki indexing)
  service?: string;
  environment?: string;
  code?: string;
  module?: string;
  source?: string; // Request source (e.g., "web", "mobile", "api", "internal")

  // High-cardinality fields (for filtering/searching)
  trace_id?: string;
  request_id?: string;
  user_id?: string;

  // Additional metadata
  [key: string]: unknown;
}

// 创建pino实例，配置为输出JSON格式，优化Loki支持
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    // 添加服务基础信息作为默认字段
    service: process.env.SERVICE_NAME ?? "api",
    environment: process.env.NODE_ENV ?? "development",
    pid: process.pid,
    hostname: process.env.HOSTNAME,
  },
  formatters: {
    level: (label) => {
      return { level: label };
    },
    // 确保error对象正确序列化
    bindings: (bindings: Record<string, unknown>) => {
      return {
        pid: bindings.pid as number,
        hostname: bindings.hostname as string,
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // 序列化error对象，确保stack trace可见
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

// 封装常用的日志方法
export const log = {
  /**
   * Log info level message
   * @example
   * log.info("User created", { code: "USER_CREATED", user_id: "123", module: "auth" })
   */
  info: (message: string, data?: LogContext) => {
    logger.info(data, message);
  },

  /**
   * Log error level message
   * @example
   * log.error("Payment failed", { code: "PAYMENT_ERROR", err: error, module: "payment" })
   */
  error: (message: string, data?: LogContext & { err?: Error }) => {
    logger.error(data, message);
  },

  /**
   * Log warning level message
   * @example
   * log.warn("Rate limit approaching", { code: "RATE_LIMIT_WARN", user_id: "123" })
   */
  warn: (message: string, data?: LogContext) => {
    logger.warn(data, message);
  },

  /**
   * Log debug level message
   * @example
   * log.debug("Cache hit", { code: "CACHE_HIT", key: "user:123" })
   */
  debug: (message: string, data?: LogContext) => {
    logger.debug(data, message);
  },

  /**
   * Create a child logger with default context
   * Useful for adding consistent context across multiple log calls
   * @example
   * const requestLogger = log.withContext({
   *   trace_id: "abc123",
   *   request_id: "req456",
   *   module: "auth"
   * });
   * requestLogger.info("Processing request", { code: "REQUEST_START" });
   * requestLogger.info("Request completed", { code: "REQUEST_END", duration: 123 });
   */
  withContext: (context: LogContext) => {
    const childLogger = logger.child(context);
    return {
      info: (message: string, data?: LogContext) => {
        childLogger.info(data, message);
      },
      error: (message: string, data?: LogContext & { err?: Error }) => {
        childLogger.error(data, message);
      },
      warn: (message: string, data?: LogContext) => {
        childLogger.warn(data, message);
      },
      debug: (message: string, data?: LogContext) => {
        childLogger.debug(data, message);
      },
    };
  },
};

export default logger;
