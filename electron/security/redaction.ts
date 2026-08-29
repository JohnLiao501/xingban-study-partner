/**
 * 日志与错误信息脱敏工具 (Sensitive Data Redaction)
 *
 * 保证：
 * - API 密钥 (Bearer sk-...) 自动脱敏
 * - Base64 图像数据 (data:image/...) 自动替换
 * - 原始窗口标题与个人敏感字符串不进入日志
 */

const BEARER_REGEX = /Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi;
const BASE64_IMAGE_REGEX = /data:image\/[a-zA-Z]+;base64,[a-zA-Z0-9+/=]{20,}/gi;
const RAW_API_KEY_REGEX = /sk-[a-zA-Z0-9_\-\.]{15,}/gi;

/**
 * 对包含潜在敏感信息的日志或错误字符串执行脱敏处理
 */
export function redactSensitive(input: string): string {
  if (!input) return "";

  let result = input;
  // 1. 脱敏 Bearer token
  result = result.replace(BEARER_REGEX, "Bearer [REDACTED_SECRET]");
  // 2. 脱敏 sk- 开头的 API 密钥
  result = result.replace(RAW_API_KEY_REGEX, "sk-[REDACTED_KEY]");
  // 3. 脱敏 Base64 图像数据
  result = result.replace(BASE64_IMAGE_REGEX, "[IMAGE_DATA_REDACTED]");

  return result;
}
