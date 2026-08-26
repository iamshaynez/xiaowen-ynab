import { describe, it, expect } from "vitest";
import { formatForIm } from "./format.mjs";

describe("formatForIm：Markdown 转为 IM 纯文本", () => {
  it("完整移除 mermaid 代码块", () => {
    const out = formatForIm("结论如下\n```mermaid\npie title 支出\n  \"餐饮\" : 45\n```\n完成");
    expect(out).not.toContain("mermaid");
    expect(out).not.toContain("pie");
    expect(out).toContain("结论如下");
    expect(out).toContain("完成");
  });

  it("普通代码块去掉围栏但保留内容", () => {
    const out = formatForIm("```sql\nSELECT 1;\n```");
    expect(out).not.toContain("```");
    expect(out).toContain("SELECT 1;");
  });

  it("行内代码与加粗斜体标记被剥掉", () => {
    const out = formatForIm("**余额**为 `1234` 分，*注意*留存");
    expect(out).toBe("余额为 1234 分，注意留存");
  });

  it("链接转为 文本（URL） 形式", () => {
    const out = formatForIm("参考[文档](https://example.com/a)说明");
    expect(out).toBe("参考文档（https://example.com/a）说明");
  });

  it("图片保留 URL", () => {
    const out = formatForIm("![图](https://img.example/x.png)");
    expect(out).toContain("https://img.example/x.png");
  });

  it("标题井号被移除", () => {
    const out = formatForIm("## 支出分析\n正文");
    expect(out.startsWith("支出分析")).toBe(true);
    expect(out).not.toContain("#");
  });

  it("连续空行折叠为最多一个空行并去除首尾空白", () => {
    const out = formatForIm("\n\na\n\n\n\nb\n\n");
    expect(out).toBe("a\n\nb");
  });
});
