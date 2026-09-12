Use the supplied local database table to answer this question:

what are the number of league apps ted davis has?

The name of this table is Football_Player_Stats, and the headers of this table are Name,Nation,Position,League Apps,League Goals,FA Cup Apps,FA Cup Goals,Total Apps,Total Goals.

Read `input/README.md`. Inspect the database schema with `python3 input/db_tool.py --schema`, then formulate and actually execute SQLite SQL using `input/db_tool.py`. Use only the complete supplied table in `input/table.json` as the factual source. You may run diagnostic queries and correct errors. All columns are stored as TEXT; inspect values and explicitly convert numerical text when necessary.

Write the answer values as a JSON array to `output/answer.txt`. Save the SQL actually used to `output/query.sql` and its actual tool JSON response to `output/query-result.json` (for example: `python3 input/db_tool.py --sql-file output/query.sql > output/query-result.json`). Keep the input materials unchanged. You have up to 600 seconds.
