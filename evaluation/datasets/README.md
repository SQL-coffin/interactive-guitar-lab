# Datasets

- `examples/`: annotated example manifest and annotation files that document the format. The example annotation is validated by the test suite.
- `local/`: git-ignored. Put private or licence-restricted recordings here, one directory per dataset.
- The synthetic smoke-test dataset is not committed. It is generated deterministically with `python -m guitar_eval make-synthetic <dir>`, and its audio is synthetic tones, not guitar recordings.

See `../README.md` for the format, validation, scenarios and how to run the benchmark.
