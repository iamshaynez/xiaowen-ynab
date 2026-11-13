// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../store", () => ({
  useApp: () => ({
    boot: { accounts: [], settings: { currencySymbol: "¥" } },
    t: (k: string) => k,
    lang: "zh",
    setLang: vi.fn(),
  }),
}));

import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("Sidebar", () => {
  it("links to the project repository in the footer", () => {
    render(<Sidebar route="#/budget" />);
    const link = screen.getByRole("link", { name: "iamshaynez/xiaowen-ynab" });
    expect(link.getAttribute("href")).toBe("https://github.com/iamshaynez/xiaowen-ynab");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
