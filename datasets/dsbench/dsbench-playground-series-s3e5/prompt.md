This is the official DSBench data-modeling resplit, not the original Kaggle test split. Use only input/train.csv and input/test.csv for modeling. Do not join a competition, post messages, download original competition labels, or submit to an external leaderboard.

Original task description:
Evaluation

Submissions are scored based on the quadratic weighted kappa, which measures the agreement between two outcomes. This metric typically varies from 0 (random agreement) to 1 (complete agreement). In the event that there is less agreement than expected by chance, the metric may go below 0.

The quadratic weighted kappa is calculated as follows. First, an N x N histogram matrix O is constructed, such that O_i,j corresponds to the number of Ids i (actual) that received a predicted value j. An N-by-N matrix of weights, w, is calculated based on the difference between actual and predicted values:
\[ w_{i,j} = \frac{(i-j)^2}{(N-1)^2} \]

An N-by-N histogram matrix of expected outcomes, E, is calculated assuming that there is no correlation between values. This is calculated as the outer product between the actual histogram vector of outcomes and the predicted histogram vector, normalized such that E and O have the same sum.

From these three matrices, the quadratic weighted kappa is calculated as:
\[ \kappa = 1 - \frac{\sum_{i,j} w_{i,j}O_{i,j}}{\sum_{i,j} w_{i,j}E_{i,j}} \]

Submission File

For each Id in the test set, you must predict the value for the target quality. The file should contain a header and have the following format:
```
Id,quality
2056,5
2057,7
2058,3
etc.
```

Dataset Description

The dataset for this competition (both train and test) was generated from a deep learning model trained on the Wine Quality dataset. Feature distributions are close to, but not exactly the same, as the original. Feel free to use the original dataset as part of this competition, both to explore differences as well as to see whether incorporating the original in training improves model performance.

Files

- train.csv - the training dataset; quality is the target (ordinal, integer)
- test.csv - the test dataset; your objective is to predict quality
- sample_submission.csv - a sample submission file in the correct format

DSBench local split and delivery contract (takes precedence over original competition sample sizes/paths): train rows=1644; test rows=412. The target is quality. Fit a model using training data; output integer quality class in the training label range. Score: quadratic weighted kappa, N=10 (maximize). Write output/submission.csv with exactly 412 rows and columns Id,quality, preserving every Id and the exact row order of input/test.csv. The old competition sample submission is intentionally omitted because its IDs and size do not match this resplit. Deliver executable training/inference code as output/train.py and a brief validation/method summary as output/response.txt. Use a fixed random seed, check missing values and data leakage, and do not tune on hidden test answers.

DSHEval execution boundary: work only inside the evaluator-provisioned, isolated benchmark workspace and tools. Never operate the user's real accounts or services. Do not access private answers, gold patches, hidden tests, later-session instructions, or online solutions for this case. Use actual tool feedback and verify your result. If a required prerequisite is missing, stop and identify it in output/response.txt; do not replace execution with a proposed solution or claim success.
