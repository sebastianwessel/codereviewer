package counter

import "sync"

// Registry hands out a stable sequential id per name, caching the result so a
// repeated name always resolves to the same id.
type Registry struct {
	mu   sync.Mutex
	next int
	ids  map[string]int
}

func NewRegistry() *Registry {
	return &Registry{ids: make(map[string]int)}
}

func (r *Registry) IDFor(name string) int {
	r.mu.Lock()
	existing, ok := r.ids[name]
	r.mu.Unlock()

	if ok {
		return existing
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	id := r.next
	r.next++
	r.ids[name] = id
	return id
}
