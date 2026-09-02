import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, listMeta, normalizeList, unwrapList } from './pagination';

describe('unwrapList', () => {
  it('returns a bare array unchanged', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    expect(unwrapList(arr)).toBe(arr);
  });

  it('extracts the data array out of a paginator envelope', () => {
    const envelope = { data: [{ id: 1 }], current_page: 1, last_page: 3, per_page: 20, total: 45 };
    expect(unwrapList(envelope)).toEqual([{ id: 1 }]);
  });

  it('returns an empty array for an empty envelope', () => {
    const envelope = { data: [], current_page: 1, last_page: 1, per_page: 20, total: 0 };
    expect(unwrapList(envelope)).toEqual([]);
  });

  it('returns an empty array for null or undefined without throwing', () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList(undefined)).toEqual([]);
  });

  it('returns an empty array when data is present but not an array', () => {
    expect(unwrapList({ data: {} })).toEqual([]);
  });
});

describe('listMeta', () => {
  it('derives meta from array length when given a bare array', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    expect(listMeta(arr)).toEqual({ total: 2, currentPage: 1, lastPage: 1, perPage: 2 });
  });

  it('reads total/current_page/last_page/per_page off a paginator envelope', () => {
    const envelope = { data: [{ id: 1 }], current_page: 2, last_page: 5, per_page: 20, total: 93 };
    expect(listMeta(envelope)).toEqual({ total: 93, currentPage: 2, lastPage: 5, perPage: 20 });
  });

  it('does not throw and returns zeroed meta for null or undefined', () => {
    expect(listMeta(null)).toEqual({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
    expect(listMeta(undefined)).toEqual({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  });

  it('handles an empty envelope without inventing a non-zero total', () => {
    const envelope = { data: [], current_page: 1, last_page: 1, per_page: 20, total: 0 };
    expect(listMeta(envelope)).toEqual({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  });
});

describe('normalizeList', () => {
  it('combines items and meta from a paginator envelope, with total larger than the loaded page', () => {
    const envelope = { data: [{ id: 1 }], current_page: 1, last_page: 4, per_page: 1, total: 4 };
    expect(normalizeList(envelope)).toEqual({
      items: [{ id: 1 }],
      total: 4,
      currentPage: 1,
      lastPage: 4,
      perPage: 1,
    });
  });

  it('combines items and meta from a bare array', () => {
    const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(normalizeList(arr)).toEqual({
      items: arr,
      total: 3,
      currentPage: 1,
      lastPage: 1,
      perPage: 3,
    });
  });

  it('never throws on a null or undefined payload', () => {
    expect(normalizeList(null)).toEqual({ items: [], total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
    expect(normalizeList(undefined)).toEqual({ items: [], total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  });
});

describe('fetchAllPages', () => {
  it('returns the single page as-is when there is only one page', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], current_page: 1, last_page: 1, per_page: 100, total: 2 });
    const result = await fetchAllPages(fetchPage);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('fetches every remaining page in parallel and concatenates them in order', async () => {
    const pages = {
      1: { data: [{ id: 1 }], current_page: 1, last_page: 3, per_page: 1, total: 3 },
      2: { data: [{ id: 2 }], current_page: 2, last_page: 3, per_page: 1, total: 3 },
      3: { data: [{ id: 3 }], current_page: 3, last_page: 3, per_page: 1, total: 3 },
    };
    const fetchPage = vi.fn(({ page }) => Promise.resolve(pages[page]));

    const result = await fetchAllPages(fetchPage, { status: 'active' }, { perPage: 1 });

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenCalledWith({ status: 'active', page: 1, per_page: 1 });
    expect(fetchPage).toHaveBeenCalledWith({ status: 'active', page: 3, per_page: 1 });
  });

  it('passes a bare array through untouched', async () => {
    const fetchPage = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const result = await fetchAllPages(fetchPage);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
