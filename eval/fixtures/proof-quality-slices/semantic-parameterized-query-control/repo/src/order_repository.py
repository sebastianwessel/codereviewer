import sqlite3


def find_orders_by_status(
    conn: sqlite3.Connection, status: str
) -> list[tuple[int, float]]:
    """Return (id, total) pairs for every order in the given status."""
    cursor = conn.execute(
        "SELECT id, total FROM orders WHERE status = ?",
        (status,),
    )
    return cursor.fetchall()
