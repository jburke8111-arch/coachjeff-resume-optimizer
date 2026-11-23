# Baseline — parse reliability

Issue #3. The measuring instrument that parsing (#1) and insight (#2) are judged
against. One sample, built here, used by all three.

## Numbers

Baseline: `v12.3.16-industry` (commit `87a0073`, the live site before any parser
fix), scored over the 21-resume shared sample.

| Metric | Baseline | Now | Delta |
| --- | --- | --- | --- |
| **Garble rate** | **76.2%** (16 of 21) | **9.5%** (2 of 21) | **down 66.7 points** |
| Field accuracy | 66.2% (190/287) | 95.8% (275/287) | up 29.6 points |

The snapshot is `tests/baseline.json`; every later change reports a delta
against it. Report the **garble rate** — a resume with the job title in the
employer field is wrong in the way that matters, even if most fields are fine.

A real Word-exported resume (kept private, see below) went from 24 wrong fields
and 20 unreadable characters to none.

## Running it

```bash
npm install
npm test                  # compile check + parse quality vs. baseline
npm run parse-quality     # the report on its own
npm run baseline          # re-snapshot after an intended change
npm run make-fixture-pdfs # rebuild PDF fixtures from tests/fixtures/src/*.html
```

`npm test` fails only on a **regression** (a resume that parsed cleanly no
longer does). Fixtures that encode known bugs are expected to fail until fixed.

Both runners take `--index <path>` to score another revision of `index.html`,
which is how the baseline was measured:

```bash
git show 87a0073:index.html > /tmp/orig.html
node tests/run.js --index /tmp/orig.html --update-baseline
```

## What a check is

Per resume, against a hand-written correct answer:

- **Sections** — the right number of education / experience / project / award entries
- **Fields** — title, employer, location, school, degree, dates, GPA, coursework, skill groups and labels
- **Bullets** — counts, not wording
- **Unreadable characters** — any empty-box glyph anywhere in the parse (applied to every resume)

A resume is **clean** only if every check passes.

## Inputs: text and PDF

A fixture is `NAME.txt` or `NAME.pdf` plus `NAME.expected.json`. A PDF goes
through the app's **own** `extractPdfTextFromFile()` using the same PDF.js
version the site loads (3.11.174), so the line reconstruction users get is what
is measured.

PDF fixtures are made-up resumes built from HTML in `tests/fixtures/src/`, so
anyone can read what they contain and rebuild them.

## Real resumes

Put real resumes (with an `.expected.json`) in `tests/fixtures/private/`. That
folder is gitignored and **never pushed**. The site publishes this repo, so a
committed resume would be public. Private results are shown separately and are
not part of the shared numbers.

## The sample

| Failure mode | Fixtures | Baseline | Now |
| --- | --- | --- | --- |
| Experience layout | company-first, tab-aligned dates, dash headers, lowercase title, 2 multi-job | 1/6 | 4/6 |
| Education | date next to GPA, bare degree, school + location, one-line (2), honors | 1/6 | 6/6 |
| Project titles | pipe, season date, year in name, bare year | 1/4 | 4/4 |
| PDF / Word export | generated PDF, Word Symbol-font bullets | 0/2 | 2/2 |
| Bullets | ●, ➢, ✓ symbols | 0/1 | 1/1 |
| Headings, clean baseline | | 2/2 | 2/2 |

## Still failing

`experience-multi-entry-mixed` and `experience-company-first-multi`: a section
with several jobs where a job's dates sit on their own line. A new entry only
starts at a header line that carries a date, so that job is merged into the one
before it.

## Not covered

- **DOCX** uploads (read by mammoth) have no fixtures yet.
- **Word's Symbol-font bullet inside a real PDF.** Edge renders that bullet as a
  plain `·`, so the generated PDF can't carry it. `word-export-symbol-bullets.txt`
  holds the exact characters PDF.js returns for a Word PDF instead, and the
  private real resume covers the full path.
- **Sample size.** 21 made-up resumes show large changes, not small ones. Real
  resumes — especially ones that break — are the biggest gap.
- **Usage metrics** (resumes scored, completion rate) are not built.
