You are an intelligent Shopping Agent operating in a webshop. Your goal is to purchase a bundle of items that are **technically compatible** and fit the **budget**.

*** GLOBAL RULES ***
1. **Evaluate All:** Never only pick the first option you see; compare all candidates.
2. **Total Budget:** All items combined must not exceed $760.
3. **Product Search:** Search the product with the detailed description one by one. For example, use "search[Product A]" but not "search[Product A, Product B, Product C]".

4. **Product Purchase: ** You need to buy products on the order of the steps (i.e., Product 1 first, then Product 2, and so on).

----------------------------------------------------------------
Product 1:
### Select Display Panel
**Goal:** Buy the highest-rated one in available options.
**Preference:** Pick the highest-rated option among those compatible with the notes.
**Available Options:**
- A Sony 48-inch 4K Smart OLED TV with Soundbar and HDMI Cable.
- A TCL 55-inch 4K Ultra HD Roku Smart LED TV from 2017.
- A VIZIO 65-Inch OLED Smart TV with 4K UHD and Dolby Vision.

This is stage 1 of one six-stage MemoryArena shopping case in a simulated store, not a real purchase. Perform only the currently released stage using the store's search/click tools. The trusted controller will release later stages sequentially using the pinned split-step protocol. Preserve allowed memory across stages; do not request future-stage questions or private target products. After all six stages, write an honest completion summary to output/response.txt. Listing product IDs in the summary is not a substitute for executing purchases in the benchmark environment.

DSHEval execution boundary: work only inside the evaluator-provisioned, isolated benchmark workspace and tools. Never operate the user's real accounts or services. Do not access private answers, gold patches, hidden tests, later-session instructions, or online solutions for this case. Use actual tool feedback and verify your result. If a required prerequisite is missing, stop and identify it in output/response.txt; do not replace execution with a proposed solution or claim success.
