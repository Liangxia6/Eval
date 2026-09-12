# Local database task

The complete table is in `input/table.json`. `input/db_tool.py` builds an in-memory
SQLite database from it on every invocation and executes one read-only statement.
It uses Python 3.9+ and its standard-library sqlite3 module; no service, network,
database installation, or credentials are needed.

```sh
python3 input/db_tool.py --schema
python3 input/db_tool.py --sql 'SELECT COUNT(*) FROM "your table name";'
mkdir -p output
# Write your own SQL to output/query.sql, then execute it:
python3 input/db_tool.py --sql-file output/query.sql > output/query-result.json
```

Use the supplied table to answer the question. Preserve every supplied record.
The benchmark's original initializer creates every column as TEXT, regardless of
its metadata type; this adapter also uses TEXT, with SQLite NOCASE collation.
For numerical comparisons or sorting, inspect the values and use explicit CAST
where needed. Quoted identifiers preserve spaces and punctuation. SQLite syntax
is required; this helper does not emulate every MySQL feature or collation.

Put the answer values in `output/answer.txt` as a JSON array, e.g. `["value"]`.
Also deliver the SQL you actually executed in `output/query.sql` and its actual
JSON response in `output/query-result.json`. Do not edit the input files. You may
inspect the schema, execute diagnostic queries, and revise a query after an error.

This is a local adaptation of the original AgentBench v0.2 DBBench SELECT tasks.
It retains the task's full table; it is not the full upstream MySQL environment.
It does not claim equivalence to the original AgentBench leaderboard metric.
The supplied table contents are benchmark fixtures, not verified real-world facts.
