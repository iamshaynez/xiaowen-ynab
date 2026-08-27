// 极简 S3 (SigV4) 客户端单测：不联网，用固定时间断言签名结构与解析逻辑。
import { describe, it, expect } from "vitest";

const { signRequest, s3ListObjects, s3DeleteObjects } = await import("./s3.mjs");

const cfg = {
  endpoint: "https://acct123.r2.cloudflarestorage.com",
  bucket: "my-bucket",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI",
};

const FIXED_NOW = new Date("2026-08-27T03:04:05Z");
const fixedOpt = { now: FIXED_NOW };

describe("signRequest（SigV4 签名，纯函数）", () => {
  it("PUT：签名头含 AWS4-HMAC-SHA256、路径风格 URL、x-amz 日期", () => {
    const r = signRequest(cfg, "PUT", "xiaowen-ynab-backup/budget-2026-08-27-030405.sql.gz", {
      body: Buffer.from("hello"),
      ...fixedOpt,
    });
    expect(r.url).toBe(
      `https://acct123.r2.cloudflarestorage.com/my-bucket/xiaowen-ynab-backup/budget-2026-08-27-030405.sql.gz`
    );
    expect(r.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260827\/auto\/s3\/aws4_request,/);
    expect(r.headers["authorization"]).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date,");
    expect(r.headers["x-amz-date"]).toBe("20260827T030405Z");
    // 空 payload 与非空 payload 的 sha256 承诺值必须不同
    const empty = signRequest(cfg, "GET", "", { query: {}, ...fixedOpt });
    expect(empty.headers["x-amz-content-sha256"]).not.toBe(r.headers["x-amz-content-sha256"]);
  });

  it("ListObjectsV2 查询参数按字母序编码进 URL", () => {
    const r = signRequest(cfg, "GET", "", { query: { "list-type": "2", prefix: "p/", "max-keys": "1000" }, ...fixedOpt });
    expect(r.url).toContain("?list-type=2&max-keys=1000&prefix=p%2F");
  });

  it("同一请求内容产生稳定签名；秘密不同则签名不同", () => {
    const a = signRequest(cfg, "PUT", "k", { body: "x", ...fixedOpt });
    const b = signRequest(cfg, "PUT", "k", { body: "x", ...fixedOpt });
    const c = signRequest({ ...cfg, secretAccessKey: "other" }, "PUT", "k", { body: "x", ...fixedOpt });
    const sig = (h) => h.headers["authorization"].split("Signature=")[1];
    expect(sig(a)).toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
  });
});

describe("s3ListObjects：解析 ListBucketResult XML", () => {
  it("提取 Key/LastModified 列表", async () => {
    const calls = [];
    const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>xiaowen-ynab-backup/budget-2026-08-20-030000.sql.gz</Key><LastModified>2026-08-20T03:00:10.000Z</LastModified></Contents>
  <Contents><Key>unrelated.txt</Key><LastModified>2026-08-21T00:00:00.000Z</LastModified></Contents>
</ListBucketResult>`;
    const fakeFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => xml };
    };
    const objs = await s3ListObjects(cfg, "xiaowen-ynab-backup/", { fetchImpl: fakeFetch, now: FIXED_NOW });
    expect(objs).toHaveLength(2);
    expect(objs[0].key).toBe("xiaowen-ynab-backup/budget-2026-08-20-030000.sql.gz");
    expect(objs[0].lastModified).toBe("2026-08-20T03:00:10.000Z");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url).toContain("list-type=2&max-keys=1000&prefix=xiaowen-ynab-backup%2F");
  });

  it("HTTP 非 2xx 时抛出带状态码的错误", async () => {
    const fakeFetch = async () => ({
      ok: false,
      status: 403,
      text: async () => "<Error><Code>AccessDenied</Code><Message>bad key</Message></Error>",
    });
    await expect(s3ListObjects(cfg, "", { fetchImpl: fakeFetch, now: FIXED_NOW })).rejects.toThrow(/403.*AccessDenied|AccessDenied.*403/s);
  });
});

describe("s3DeleteObjects：批量删除请求", () => {
  it("POST ?delete= 且 body 为合法 Delete XML，附带 content-md5 并参与签名", async () => {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '<DeleteResult><Deleted><Key>k</Key></Deleted></DeleteResult>' };
    };
    await s3DeleteObjects(cfg, ["a/b.sql.gz", "c<d.sql.gz"], { fetchImpl: fakeFetch, now: FIXED_NOW });
    const { url, init } = calls[0];
    expect(init.method).toBe("POST");
    expect(url.endsWith("/my-bucket?delete=")).toBe(true);
    const bodyText = Buffer.from(init.body).toString();
    expect(bodyText).toContain("<Object><Key>a/b.sql.gz</Key></Object>");
    expect(bodyText).toContain("c&lt;d.sql.gz");
    expect(init.headers["content-md5"]).toBeTruthy();
    expect(init.headers["authorization"]).toContain("SignedHeaders=content-md5;host;x-amz-content-sha256;x-amz-date,");
  });

  it("空列表不发请求", async () => {
    let called = 0;
    const fakeFetch = async () => (called++, { ok: true, status: 200, text: async () => "" });
    await s3DeleteObjects(cfg, [], { fetchImpl: fakeFetch, now: FIXED_NOW });
    expect(called).toBe(0);
  });
});
