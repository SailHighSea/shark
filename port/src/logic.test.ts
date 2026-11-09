import { describe, expect, it } from "vitest";
import {
  breadcrumbs, formatSize, History, joinPath, navigate, rangeBetween, stemLength, typeSelect, type Entry,
} from "./logic";

const e = (name: string): Entry => ({
  name, path: `/d/${name}`, kind: "file", is_symlink: false, size: 0, modified: null, hidden: false, ext: "",
});
const items = ["apple", "Avocado", "banana", "cherry"].map(e);

describe("paths", () => {
  it("splits posix and windows paths", () => {
    expect(breadcrumbs("/home/me").map((c) => c.path)).toEqual(["/", "/home", "/home/me"]);
    expect(breadcrumbs("C:\\Users\\me").map((c) => c.path)).toEqual(["C:\\", "C:\\Users", "C:\\Users\\me"]);
    expect(breadcrumbs("C:\\").length).toBe(1);
  });
  it("joins", () => {
    expect(joinPath("/a", "b")).toBe("/a/b");
    expect(joinPath("/", "b")).toBe("/b");
    expect(joinPath("C:\\", "b")).toBe("C:\\b");
  });
});

describe("formatSize", () => {
  it("uses decimal units", () => {
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1500)).toBe("1.5 KB");
    expect(formatSize(250_000_000)).toBe("250 MB");
  });
});

describe("History", () => {
  it("goes back and forward and drops forward on a new visit", () => {
    const h = new History("/a");
    h.visit("/b");
    h.visit("/c");
    expect(h.goBack()).toBe("/b");
    expect(h.goForward()).toBe("/c");
    h.goBack();
    h.visit("/x");
    expect(h.canForward()).toBe(false);
    expect(h.goBack()).toBe("/b");
    expect(new History("/a").goBack()).toBeNull();
  });
});

describe("selection", () => {
  it("selects a range in either direction", () => {
    expect(rangeBetween(items, "/d/apple", "/d/banana")).toEqual(["/d/apple", "/d/Avocado", "/d/banana"]);
    expect(rangeBetween(items, "/d/cherry", "/d/Avocado")).toEqual(["/d/Avocado", "/d/banana", "/d/cherry"]);
    expect(rangeBetween(items, null, "/d/banana")).toEqual(["/d/banana"]);
  });
  it("moves the cursor", () => {
    expect(navigate("ArrowDown", -1, 4, 1)).toBe(0);
    expect(navigate("ArrowUp", -1, 4, 1)).toBe(3);
    expect(navigate("ArrowDown", 3, 4, 1)).toBe(3);
    expect(navigate("ArrowDown", 0, 10, 4)).toBe(4);
    expect(navigate("ArrowLeft", 0, 10, 1)).toBe(0);
    expect(navigate("End", 0, 10, 1)).toBe(9);
    expect(navigate("Home", 5, 0, 1)).toBe(-1);
  });
  it("types to select and cycles repeated letters", () => {
    expect(typeSelect(items, "ban", 0)).toBe(2);
    expect(typeSelect(items, "a", 0)).toBe(1);
    expect(typeSelect(items, "aa", 1)).toBe(0);
    expect(typeSelect(items, "zzz", 0)).toBe(-1);
  });
});

describe("stemLength", () => {
  it("keeps the extension out of the selection", () => {
    expect(stemLength("report.pdf", false)).toBe(6);
    expect(stemLength(".bashrc", false)).toBe(7);
    expect(stemLength("v1.2", true)).toBe(4);
  });
});
