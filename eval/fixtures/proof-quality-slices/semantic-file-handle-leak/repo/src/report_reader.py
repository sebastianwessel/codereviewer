def first_matching_line(path: str, needle: str) -> str | None:
    """Return the first line in path containing needle, or None if absent."""
    handle = open(path, "r", encoding="utf-8")

    for line in handle:
        if needle in line:
            return line.rstrip("\n")

    handle.close()
    return None
