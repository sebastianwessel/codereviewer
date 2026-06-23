package search

import "sync"

type Index struct {
	docs int
}

func (i *Index) Flush() {}

type bleveBackend struct {
	cacheMu sync.RWMutex
	cache   map[string]*Index
}

func (b *bleveBackend) BuildIndex(key string) *Index {
	if idx, ok := b.cache[key]; ok {
		return idx
	}

	idx := &Index{docs: len(key)}
	idx.Flush()

	b.cacheMu.Lock()
	defer b.cacheMu.Unlock()
	b.cache[key] = idx
	return idx
}

func (b *bleveBackend) TotalDocs() int {
	total := 0
	for _, idx := range b.cache {
		total += idx.docs
	}

	return total
}
