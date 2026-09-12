Use the supplied local database table to answer this question:

What is the US cash box before 1978 with a US billboard of 35?

The name of this table is US Music Charts, and the headers of this table are Year,US Billboard,US Cash Box,US AC,CAN AC,Title.

Read `input/README.md`. Inspect the database schema with `python3 input/db_tool.py --schema`, then formulate and actually execute SQLite SQL using `input/db_tool.py`. Use only the complete supplied table in `input/table.json` as the factual source. You may run diagnostic queries and correct errors. All columns are stored as TEXT; inspect values and explicitly convert numerical text when necessary.

Write the answer values as a JSON array to `output/answer.txt`. Save the SQL actually used to `output/query.sql` and its actual tool JSON response to `output/query-result.json` (for example: `python3 input/db_tool.py --sql-file output/query.sql > output/query-result.json`). Keep the input materials unchanged. You have up to 600 seconds.
