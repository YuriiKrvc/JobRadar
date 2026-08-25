version: 1

Score the vacancy against the candidate CV on five dimensions, each 0-100.

- coreStack: overlap between required technologies and what the CV shows was
  actually shipped. 0 = no overlap, 50 = adjacent, 100 = direct match.
- seniority: 0 = clear mismatch either direction, 100 = exactly the right level.
- domain: familiarity with the industry or problem space.
- logistics: remote policy, timezone, location, and employment type against the
  candidate's stated constraints.
- growth: does this move the candidate toward the next step named in the CV.

For each dimension give an integer score and a one-sentence justification.
Do not compute a total. Do not recommend applying or not applying.
