# Baseline — parse reliability

Issue #3. This is the measuring instrument that parsing (#1) and insight (#2)
are judged against. One sample, built here, used by all three.

## Numbers

Baseline recorded against `v12.3.16-industry` (commit `87a0073`, before any
parser fix), scored over the 13-resume labeled sample:

| Metric | Baseline | After #1 v1 | Delta |
| --- | --- | --- | --- |
| **Garble rate** | **69.2%** (9 of 13) | **15.4%** (2 of 13) | **down 53.8 points** |
| Field accuracy | 74.6% (88/118) | 89.8% (106/118) | up 15.2 points |

The committed snapshot is `tests/baseline.json`. Every later parser change
reports a delta against it.

Note the gap between the two rows: field accuracy always looks healthier than
the garble rate, because most fields on most resumes are fine. The garble rate
is the honest number — a resume with the job title in the employer field is
wrong in the way the person using it cares about. **Report the garble rate.**

## Running it

```bash
npm test              # compile guard + parse quality vs. baseline; non-zero on regression
npm run parse-quality # the report on its own
npm run baseline      # re-snapshot after an intended change
```

Both runners take `--index <path>` to score a *different* revision of
`index.html`, which is how the before/after above was measured over one fixture
set rather than approximated:

```bash
git show HEAD:index.html > /tmp/orig.html
node tests/run.js --index /tmp/orig.html --update-baseline
```

`npm test` is the gate, and it is deliberately asymmetric:

- a fixture that was clean and is now garbled **fails the run** (regression)
- a fixture that was garbled and is now clean is reported as the win

Fixtures are expected to start red — they encode known bugs. "All green" is not
the bar. "Nothing that worked stopped working, and the garble rate went down" is.

`npm test` also runs `tools/check-app-compiles.js` first, which reproduces the
browser's exact startup path (same Babel version, same preset, same
`new Function` construction). The app has no build step, so a syntax error in
`index.html` would otherwise reach users as a blank page rather than failing in
CI.

## How the metric is defined

Per the issue's instruction to start simple: for each resume we already know the
correct answer, and we check the fields a downstream engine actually depends on.

- **Sections** — did the right number of education / experience / project
  entries come back?
- **Entry fields** — title, org, location, school, degree, dates.
- **Bullets** — counts, not text. A parser that loses or invents a bullet has
  garbled the resume; whether it reproduced the wording is a different question.
- **Contact** — name, email, phone, city/state.

Comparison is exact after normalising whitespace and unicode dashes/quotes. A
resume is **clean** only if every check passes; otherwise it is **garbled**.

Fuzzier scoring (bullet text similarity, partial-credit dates) was deliberately
left out. Add it only if this proves too blunt to show a delta.

## The sample

`tests/fixtures/` — one `NAME.txt` (input) plus one `NAME.expected.json`
(ground truth) per resume. The `expect` block only needs the fields that resume
is about, so a fixture can target one failure mode without asserting everything.

Stratified on purpose — a sample of only clean single-column resumes would make
the parser look fine and prove nothing.

| Fixture | Failure mode | Baseline | Now |
| --- | --- | --- | --- |
| `clean-single-column` | none (regression guard) | clean | clean |
| `education-school-with-location` | education-location | clean | clean |
| `headings-nonstandard` | headings | clean | clean |
| `project-bare-year` | project-titles | clean | clean |
| `degree-abbreviation-only` | education-degree | garbled | **clean** |
| `education-date-with-gpa` | education-dates | garbled | **clean** |
| `experience-company-first` | experience-layout | garbled | **clean** |
| `experience-tab-aligned-dates` | experience-layout | garbled | **clean** |
| `project-pipe-delimiter` | project-titles | garbled | **clean** |
| `project-season-date` | project-titles | garbled | **clean** |
| `project-year-in-name` | project-titles | garbled | **clean** |
| `experience-multi-entry-mixed` | experience-layout | garbled | garbled |
| `experience-company-first-multi` | experience-layout | garbled | garbled |

The last two were found by **held-out testing**, not by the sample. After the
first round of fixes every fixture passed, which is exactly what overfitting
looks like — so the parser was run against realistic resumes that no fixture
covered, and two real failures turned up immediately. Both are now fixtures. The
lesson generalises: a green suite means the sample stopped being adversarial,
not that the parser is finished.

### Adding real resumes

Real resumes go in `tests/fixtures/private/`, which is gitignored and picked up
automatically by the runner.

**Never commit a real resume.** This repo publishes its own root, so a file in
`tests/fixtures/` is a file on the public site. That is why the private
directory exists.

## What this baseline does NOT cover

Stated plainly so the number is not read as more than it is.

1. **PDF and DOCX extraction are untested.** Every fixture is `.txt`, which
   enters the parser *after* `extractPdfTextFromFile` / mammoth have run. So
   this measures the text parser, not the PDF.js Y-coordinate line
   reconstruction that issue #1 names as a prime suspect. Real `.pdf` and
   `.docx` fixtures are the single biggest gap — and they need real files, not
   synthetic ones.
2. **The sample is synthetic and small.** Thirteen hand-written resumes modelled
   on real failure modes. At n=13 this detects a large move but not a few
   points. ~25–40 stratified resumes is the target before the number is worth
   quoting outside the project.
3. **Usage metrics are not built.** Resumes scored and completion rate are still
   blanks. The issue says to mirror the Job Finder's cookieless approach rather
   than design a new one — that needs access to the sibling repo.
