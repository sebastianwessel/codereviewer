export type Page = {
  readonly pageNumber: number
  readonly items: readonly number[]
}

// Split values into 1-based pages of pageSize items each. The final page holds
// the remainder and may contain fewer than pageSize items.
export const paginate = (
  values: readonly number[],
  pageSize: number
): readonly Page[] => {
  if (pageSize < 1) {
    throw new Error('pageSize must be at least 1')
  }

  const pages: Page[] = []
  const pageCount = Math.ceil(values.length / pageSize)

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const start = pageIndex * pageSize

    pages.push({
      pageNumber: pageIndex + 1,
      items: values.slice(start, start + pageSize)
    })
  }

  return pages
}
