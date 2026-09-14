#!/usr/bin/env python3
"""Execute read-only SQLite queries over the complete supplied benchmark table."""
import argparse
import json
import sqlite3
from pathlib import Path


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--schema", action="store_true")
    group.add_argument("--sql")
    group.add_argument("--sql-file", type=Path)
    args = parser.parse_args()
    table = json.loads(Path(__file__).with_name("table.json").read_text(encoding="utf-8"))
    columns = table["table_info"]["columns"]
    rows = table["table_info"]["rows"]
    if args.schema:
        print(json.dumps({"table": table["table_name"], "columns": [
            {"name": col["name"], "sqlite_type": "TEXT", "collation": "NOCASE",
             "upstream_metadata_type": col["type"]} for col in columns
        ], "row_count": len(rows)}, ensure_ascii=False, indent=2))
        return
    query = args.sql if args.sql is not None else args.sql_file.read_text(encoding="utf-8")
    with sqlite3.connect(":memory:") as connection:
        table_name = quote_identifier(table["table_name"])
        definitions = ", ".join(quote_identifier(col["name"]) + " TEXT COLLATE NOCASE" for col in columns)
        connection.execute("CREATE TABLE " + table_name + " (" + definitions + ")")
        connection.executemany("INSERT INTO " + table_name + " VALUES (" + ",".join("?" for _ in columns) + ")", rows)
        connection.commit()
        connection.execute("PRAGMA query_only=ON")
        allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
        if hasattr(sqlite3, "SQLITE_RECURSIVE"):
            allowed.add(sqlite3.SQLITE_RECURSIVE)

        def authorize(action, arg1, arg2, database, origin):
            if action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() == "load_extension":
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY

        steps = [0]

        def stop_expensive_query():
            steps[0] += 1
            return int(steps[0] > 1000)

        connection.set_authorizer(authorize)
        connection.set_progress_handler(stop_expensive_query, 1000)
        cursor = connection.execute(query)
        result = cursor.fetchmany(1001)
        if len(result) > 1000:
            raise ValueError("Query produced more than 1000 rows; refine the query.")
        print(json.dumps({"columns": [col[0] for col in cursor.description], "rows": result}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
