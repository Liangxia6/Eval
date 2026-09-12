# Word2Vec Preprocessing Pipeline（DSHEval 适配题）

创建或修改 `solution.py`，实现 `task_func(texts, stopwords=None)`。读取 `input/input.json` 中的文本和停用词，完成：删除非字母数字字符（保留空格）、转小写、按空白分词、删除停用词。

为了使题目可确定性评价，最终返回一个具有以下属性的模型对象：`model.tokenized_sentences`（二维字符串列表）和 `model.wv.key_to_index`（词到索引的字典）。不要求比较随机训练得到的向量数值，但函数应保持 Word2Vec 风格的模型接口。必须实际导入并运行函数。只允许修改 `solution.py`，不要修改 input、private 或 checks。
