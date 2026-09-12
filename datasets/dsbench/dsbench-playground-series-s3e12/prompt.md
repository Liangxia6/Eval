This is the official DSBench data-modeling resplit, not the original Kaggle test split. Use only input/train.csv and input/test.csv for modeling. Do not join a competition, post messages, download original competition labels, or submit to an external leaderboard.

Original task description:
Description

NOTE: You can now create your own synthetic versions of this dataset by forking and running this notebook.

Welcome to the 2023 edition of Kaggle's Playground Series! Thank you to everyone who participated in and contributed to Season 3 Playground Series so far!

With the same goal to give the Kaggle community a variety of fairly light-weight challenges that can be used to learn and sharpen skills in different aspects of machine learning and data science, we will continue launching the Tabular Tuesday in April every Tuesday 00:00 UTC, with each competition running for 2 weeks. Again, these will be fairly light-weight datasets that are synthetically generated from real-world data, and will provide an opportunity to quickly iterate through various model and feature engineering ideas, create visualizations, etc.

Synthetically-Generated Datasets

Using synthetic data for Playground competitions allows us to strike a balance between having real-world data (with named features) and ensuring test labels are not publicly available. This allows us to host competitions with more interesting datasets than in the past. While there are still challenges with synthetic data generation, the state-of-the-art is much better now than when we started the Tabular Playground Series two years ago, and the goal is to produce datasets that have far fewer artifacts.

Please feel free to give us feedback on the datasets for the different competitions so that we can continue to improve!

Evaluation

Submissions are evaluated on the area under the ROC curve between the predicted probability and the observed target.

Submission File

For each id in the test set, you must predict the probability of target (likelihood of the presence of a kidney stone). The file should contain a header and have the following format:

```
id,target
414,0.5
415,0.1
416,0.9
etc.
```

Dataset Description

NOTE:
You can now create your own synthetic versions of this dataset by forking and running this notebook.

The dataset for this competition (both train and test) was generated from a deep learning model trained on the Kidney Stone Prediction based on Urine Analysis dataset. Feature distributions are close to, but not exactly the same, as the original. Feel free to use the original dataset as part of this competition, both to explore differences as well as to see whether incorporating the original in training improves model performance.

Files:
- train.csv - the training dataset; target is the likelihood of a kidney stone being present
- test.csv - the test dataset; your objective is to predict the probability of target
- sample_submission.csv - a sample submission file in the correct format

DSBench local split and delivery contract (takes precedence over original competition sample sizes/paths): train rows=331; test rows=83. The target is target. Fit a model using training data; output finite probability between 0 and 1. Score: ROC AUC (maximize). Write output/submission.csv with exactly 83 rows and columns id,target, preserving every id and the exact row order of input/test.csv. The old competition sample submission is intentionally omitted because its IDs and size do not match this resplit. Deliver executable training/inference code as output/train.py and a brief validation/method summary as output/response.txt. Use a fixed random seed, check missing values and data leakage, and do not tune on hidden test answers.

DSHEval execution boundary: work only inside the evaluator-provisioned, isolated benchmark workspace and tools. Never operate the user's real accounts or services. Do not access private answers, gold patches, hidden tests, later-session instructions, or online solutions for this case. Use actual tool feedback and verify your result. If a required prerequisite is missing, stop and identify it in output/response.txt; do not replace execution with a proposed solution or claim success.
