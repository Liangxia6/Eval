#!/usr/bin/env python3
"""按各题 question.json 的 databaseSeed 清单下载上游数据文件并校验 sha256。

数据不随仓库分发；部署（或本地验收）时先运行：
    python3 environments/tau-bench/fetch_data.py [tau-bench tau2-bench]

清单取自每个 Case 的 source.commit（固定提交）与 environment.upstreamConstraints.
databaseSeed（路径 + sha256），下载后写入 environments/<family>/data/<path>（已 gitignore）。
"""

import hashlib
import json
import os
import sys
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATASETS_ROOT = os.path.join(REPO_ROOT, "datasets")
ENVIRONMENTS_ROOT = os.path.join(REPO_ROOT, "environments")


def fetch_family(family):
    cases_dir = os.path.join(DATASETS_ROOT, family)
    data_root = os.path.join(ENVIRONMENTS_ROOT, family, "data")
    seen = set()
    total_bytes = 0
    for case in sorted(os.listdir(cases_dir)):
        question_path = os.path.join(cases_dir, case, "question.json")
        if not os.path.isfile(question_path):
            continue
        question = json.load(open(question_path, encoding="utf-8"))
        commit = question["source"]["commit"]
        repository = question["source"]["repository"]
        seed = question["environment"].get("upstreamConstraints", {}).get("databaseSeed", [])
        for item in seed:
            key = (repository, commit, item["path"], item["sha256"])
            if key in seen:
                continue
            seen.add(key)
            url = f"{repository}/raw/{commit}/{item['path']}"
            destination = os.path.join(data_root, item["path"])
            print(f"fetch {item['path']} ({item['sha256'][:12]}…)")
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            urllib.request.urlretrieve(url, destination)
            with open(destination, "rb") as file:
                digest = hashlib.sha256(file.read()).hexdigest()
            assert digest == item["sha256"], f"{item['path']} sha256 mismatch: {digest}"
            total_bytes += os.path.getsize(destination)
    print(f"{family}: {len(seen)} files, {total_bytes} bytes -> {data_root}")


def main():
    families = sys.argv[1:] or ["tau-bench", "tau2-bench"]
    for family in families:
        fetch_family(family)
    print("done")


if __name__ == "__main__":
    main()
