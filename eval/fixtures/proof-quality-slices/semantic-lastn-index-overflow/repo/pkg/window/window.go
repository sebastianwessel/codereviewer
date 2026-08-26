package window

// LastN returns the last n elements of values. When n is greater than or equal
// to the length of values, the whole slice is returned.
func LastN(values []int, n int) []int {
	if n >= len(values) {
		return values
	}

	start := len(values) - n
	result := make([]int, 0, n)
	for i := start; i <= len(values); i++ {
		result = append(result, values[i])
	}
	return result
}
