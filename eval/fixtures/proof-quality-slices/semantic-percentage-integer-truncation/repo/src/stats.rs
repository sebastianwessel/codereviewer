/// Returns the percentage (0-100) of `passed` items out of `total`.
/// Returns 0 when there are no items to avoid dividing by zero.
pub fn pass_percentage(passed: u32, total: u32) -> u32 {
    if total == 0 {
        return 0;
    }

    (passed / total) * 100
}
