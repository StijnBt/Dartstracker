export type SortState<K extends string> = { column: K; direction: "asc" | "desc" } | null;

export type SortComparator<T> = (a: T, b: T, direction: "asc" | "desc") => number;

export function toggleSort<K extends string>(current: SortState<K>, column: K): SortState<K> {
  if (!current || current.column !== column) {
    return { column, direction: "asc" };
  }
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  comparators: Record<K, SortComparator<T>>
): T[] {
  if (!sort) return rows;
  const comparator = comparators[sort.column];
  return [...rows].sort((a, b) => comparator(a, b, sort.direction));
}

export function numericComparator<T>(
  getValue: (row: T) => number | null,
  { nullsLast = false }: { nullsLast?: boolean } = {}
): SortComparator<T> {
  return (a, b, direction) => {
    const av = getValue(a);
    const bv = getValue(b);
    if (nullsLast) {
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
    }
    const diff = (av ?? 0) - (bv ?? 0);
    return direction === "asc" ? diff : -diff;
  };
}

export function stringComparator<T>(getValue: (row: T) => string): SortComparator<T> {
  return (a, b, direction) => {
    const result = getValue(a).localeCompare(getValue(b), undefined, { sensitivity: "base" });
    return direction === "asc" ? result : -result;
  };
}
