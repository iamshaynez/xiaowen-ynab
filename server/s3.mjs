// 极简 S3 客户端（AWS Signature V4），仅覆盖备份所需操作，兼容 Cloudflare R2。
// 刻意不引入 @aws-sdk/client-s3：路径风格 URL + fetch + node:crypto 即可满足。
// 覆盖：ListObjectsV2（GET）、PutObject（PUT）、DeleteObjects（POST ?delete=）。
import crypto from "node:crypto";

const HOST = "aws4_request";
const ALGO = "AWS4-HMAC-SHA256";

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// RFC3986 严格编码（encodeURIComponent 会放过 !'()*）
function enc(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// 路径风格 URI：/bucket/key…，逐段编码、保留 /
function canonicalUri(bucket, key = "") {
  return ("/" + [bucket, key].filter(Boolean).join("/"))
    .split("/")
    .map((seg) => (seg === "" ? "" : enc(seg)))
    .join("/");
}

// query 按参数名字母序编码拼接
function canonicalQuery(query = {}) {
  return Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(String(query[k] ?? ""))}`)
    .join("&");
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function unescapeXml(s) {
  return String(s)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * 构造签名请求。纯函数：给固定 now 可得到稳定签名（便于测试）。
 * 返回 { url, headers }；host 不放入 headers —— 由 fetch 依据 URL 自动生成，
 * 签名侧同样以 URL host 参与 canonical headers，两者一致。
 */
export function signRequest(cfg, method, key, { query = {}, body = "", extraHeaders = {}, now = new Date() } = {}) {
  const region = cfg.region || "auto";
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body ?? "");

  const host = new URL(cfg.endpoint).host;
  // 参与签名的头部集合：x-amz-* 固定项 + 额外头（如 content-md5），统一小写
  const headers = {};
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v != null && v !== "") headers[k.toLowerCase()] = String(v);
  }
  headers["x-amz-content-sha256"] = payloadHash;
  headers["x-amz-date"] = amzDate;
  const signedNames = [...Object.keys(headers).map((k) => k.toLowerCase()), "host"].sort().join(";");
  const canonicalHeaders = ["host:" + host, ...Object.keys(headers).sort().map((k) => `${k}:${String(headers[k]).trim()}`)]
    .sort((a, b) => a.localeCompare(b))
    .map((line) => line + "\n")
    .join("");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(cfg.bucket, key),
    canonicalQuery(query),
    canonicalHeaders,
    signedNames,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/s3/${HOST}`;
  const stringToSign = [ALGO, amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  let kDate = hmac("AWS4" + cfg.secretAccessKey, dateStamp);
  kDate = hmac(kDate, region);
  kDate = hmac(kDate, "s3");
  kDate = hmac(kDate, HOST);
  const signature = crypto.createHmac("sha256", kDate).update(stringToSign).digest("hex");

  const base = `${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}${key ? "/" + canonicalUri("", key).slice(1) : ""}`;
  const qs = canonicalQuery(query);
  return {
    url: qs ? `${base}?${qs}` : base,
    headers: {
      ...headers,
      authorization: `${ALGO} Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`,
    },
    amzDate,
  };
}

/** 统一请求包装：超时、非 2xx 报错 */
async function request(cfg, method, key, opts = {}) {
  const { query = {}, body = null, timeoutMs = 30_000, now, fetchImpl = globalThis.fetch } = opts;
  if (!cfg?.endpoint || !cfg?.bucket) throw new Error("S3 config incomplete");
  const bodyBuf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const signed = signRequest(cfg, method, key, { query, body: bodyBuf ?? "", extraHeaders: opts.extraHeaders, now });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(signed.url, {
      method: method.toUpperCase(),
      headers: signed.headers,
      body: bodyBuf,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
      throw new Error(`S3 ${res.status}${code ? " " + code : ""}: ${(msg || text).slice(0, 200)}`);
    }
    return { status: res.status, text };
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`S3 request timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** ListObjectsV2 → [{ key, lastModified }] */
export async function s3ListObjects(cfg, prefix = "", opt = {}) {
  const { text } = await request(cfg, "GET", "", {
    query: { "list-type": "2", prefix, "max-keys": "1000" },
    ...opt,
  });
  const out = [];
  const contentRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  for (const m of text.matchAll(contentRe)) {
    out.push({
      key: unescapeXml(/<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? ""),
      lastModified: /<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1])?.[1] ?? "",
    });
  }
  return out;
}

export async function s3PutObject(cfg, key, body, opt = {}) {
  await request(cfg, "PUT", key, { body, ...opt });
  return true;
}

export async function s3DeleteObjects(cfg, keys, opt = {}) {
  if (!keys.length) return true;
  const body =
    `<Delete>` +
    keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join("") +
    `<Quiet>true</Quiet></Delete>`;
  await request(cfg, "POST", "", {
    query: { delete: "" },
    body,
    // S3 规范要求 Content-MD5；一并参与签名
    extraHeaders: { "content-md5": crypto.createHash("md5").update(body).digest("base64") },
    ...opt,
  });
  return true;
}
