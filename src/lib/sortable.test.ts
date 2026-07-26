import { describe, it, expect } from "vitest";
import { toggleSort, sortRows, numericComparator, stringComparator, type SortState } from "./sortable";

describe("toggleSort", () => {
  it("starts a fresh column ascending when nothing is sorted yet", () => {
    expect(toggleSort<"name">(null, "name")).toEqual({ column: "name", direction: "asc" });
  });

  it("flips direction when clicking the same column again", () => {
    const afterFirst = toggleSort<"name">(null, "name");
    expect(toggleSort(afterFirst, "name")).toEqual({ column: "name", direction: "desc" });
  });

  it("flips back to ascending on a third click of the same column", () => {
    const first = toggleSort<"name">(null, "name");
    const second = toggleSort(first, "name");
    expect(toggleSort(second, "name")).toEqual({ column: "name", direction: "asc" });
  });

  it("resets to ascending when switching to a different column", () => {
    const sortedDesc: SortState<"name" | "age"> = { column: "name", direction: "desc" };
    expect(toggleSort(sortedDesc, "age")).toEqual({ column: "age", direction: "asc" });
  });
});

describe("sortRows", () => {
  type Row = { name: string; age: number };
  const rows: Row[] = [
    { name: "Carol", age: 30 },
    { name: "alice", age: 20 },
    { name: "Bob", age: 25 },
  ];
  const comparators = {
    name: stringComparator<Row>((r) => r.name),
    age: numericComparator<Row>((r) => r.age),
  };

  it("returns rows unchanged when sort is null", () => {
    expect(sortRows(rows, null, comparators)).toBe(rows);
  });

  it("sorts ascending by the active column", () => {
    const result = sortRows(rows, { column: "age", direction: "asc" }, comparators);
    expect(result.map((r) => r.name)).toEqual(["alice", "Bob", "Carol"]);
  });

  it("sorts descending by the active column", () => {
    const result = sortRows(rows, { column: "age", direction: "desc" }, comparators);
    expect(result.map((r) => r.name)).toEqual(["Carol", "Bob", "alice"]);
  });

  it("does not mutate the original array", () => {
    const original = [...rows];
    sortRows(rows, { column: "age", direction: "asc" }, comparators);
    expect(rows).toEqual(original);
  });
});

describe("numericComparator", () => {
  type Row = { value: number | null };
  const rows: Row[] = [{ value: 30 }, { value: null }, { value: 10 }, { value: 20 }];

  it("sorts ascending by value, treating null as 0 when nullsLast is not set", () => {
    const comparator = numericComparator<Row>((r) => r.value);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "asc"));
    expect(sorted.map((r) => r.value)).toEqual([null, 10, 20, 30]);
  });

  it("sorts descending by value, treating null as 0 when nullsLast is not set", () => {
    const comparator = numericComparator<Row>((r) => r.value);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "desc"));
    expect(sorted.map((r) => r.value)).toEqual([30, 20, 10, null]);
  });

  it("keeps nulls last in ascending order when nullsLast is set", () => {
    const comparator = numericComparator<Row>((r) => r.value, { nullsLast: true });
    const sorted = [...rows].sort((a, b) => comparator(a, b, "asc"));
    expect(sorted.map((r) => r.value)).toEqual([10, 20, 30, null]);
  });

  it("keeps nulls last in descending order when nullsLast is set", () => {
    const comparator = numericComparator<Row>((r) => r.value, { nullsLast: true });
    const sorted = [...rows].sort((a, b) => comparator(a, b, "desc"));
    expect(sorted.map((r) => r.value)).toEqual([30, 20, 10, null]);
  });
});

describe("stringComparator", () => {
  type Row = { name: string };
  const rows: Row[] = [{ name: "carol" }, { name: "Alice" }, { name: "bob" }];

  it("sorts case-insensitively ascending", () => {
    const comparator = stringComparator<Row>((r) => r.name);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "asc"));
    expect(sorted.map((r) => r.name)).toEqual(["Alice", "bob", "carol"]);
  });

  it("sorts case-insensitively descending", () => {
    const comparator = stringComparator<Row>((r) => r.name);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "desc"));
    expect(sorted.map((r) => r.name)).toEqual(["carol", "bob", "Alice"]);
  });
});
