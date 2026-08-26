// 将助手输出的 Markdown 转换为适合 IM（微信/Telegram）展示的纯文本。
// 保持纯函数、不依赖 DB，便于单元测试。

export function formatForIm(md) {
  let s = String(md ?? "");

  // mermaid 图无法在 IM 渲染，整块移除
  s = s.replace(/```mermaid[\s\S]*?(?:```|$)/gi, "");
  // 普通围栏代码块：去掉围栏保留内容
  s = s.replace(/```\w*\n?([\s\S]*?)```/g, (_, code) => `\n${code.trimEnd()}\n`);

  // 图片 → 仅保留 URL；链接 → 文本（URL）
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, "$1 $2");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1（$2）");

  // 标题井号、引用符号
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^>\s?/gm, "");

  // 行内强调标记
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  // 单星斜体：仅当内容含文字（避免误伤 2*3 这类乘法）
  s = s.replace(/\*([^*\n]*[\p{L}\p{Script=Han}][^*\n]*)\*/gu, "$1");
  s = s.replace(/`([^`\n]+)`/g, "$1");

  // 水平分割线
  s = s.replace(/^\s*([-*_])\s*(?:\1\s*){2,}$/gm, "");

  // 折叠空行
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}
