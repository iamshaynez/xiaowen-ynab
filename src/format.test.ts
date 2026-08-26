import { describe, it, expect, beforeEach } from "vitest";
import { fmtMoney, fmtMoneyShort, parseAmountToCents, setCurrencySymbol } from "./format";

beforeEach(() => {
  setCurrencySymbol("¥");
});

describe("fmtMoney", () => {
  it("formats cents to currency with 2 decimals", () => {
    expect(fmtMoney(123456)).toBe("¥1,234.56");
    expect(fmtMoney(-123456)).toBe("-¥1,234.56");
    expect(fmtMoney(0)).toBe("¥0.00");
    expect(fmtMoney(500, { sign: true })).toBe("+¥5.00");
  });
});

describe("fmtMoneyShort (cents)", () => {
  it("shows full money below 1 wan", () => {
    expect(fmtMoneyShort(999999)).toBe("¥9,999.99");
    expect(fmtMoneyShort(-999999)).toBe("-¥9,999.99");
  });

  it("uses wan for values >= 10000 yuan (1e6 cents)", () => {
    expect(fmtMoneyShort(1280000)).toBe("¥1.3万");
    expect(fmtMoneyShort(1000000)).toBe("¥1.0万");
    expect(fmtMoneyShort(-5000000)).toBe("-¥5.0万");
  });

  it("rounds to integer wan for large values", () => {
    expect(fmtMoneyShort(123456789)).toBe("¥123万");
  });

  it("uses yi (1e8 yuan = 1e10 cents) with one decimal", () => {
    expect(fmtMoneyShort(150000000000)).toBe("¥15.0亿");
    expect(fmtMoneyShort(-20000000000)).toBe("-¥2.0亿");
  });
});

describe("parseAmountToCents", () => {
  it("parses plain and formatted numbers", () => {
    expect(parseAmountToCents("12.34")).toBe(1234);
    expect(parseAmountToCents("1,234.5")).toBe(123450);
    expect(parseAmountToCents("¥88")).toBe(8800);
    expect(parseAmountToCents("-3")).toBe(-300);
  });
  it("rejects garbage", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("1.2.3")).toBeNull();
  });
});
