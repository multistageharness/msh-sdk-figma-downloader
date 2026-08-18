##
## packages/Makefile — umbrella for the polyglot figma-downloader twins.
##
##   figma-downloader-ts   zero-dependency Node ESM
##   figma-downloader-py   stdlib-only Python 3.11+
##   shared/               language-neutral fixtures, goldens, parity cases
##   parity/               cross-language parity gate
##
## Both twins are zero-dependency, so `install` is a no-op beyond the Node
## lockfile. `parity` runs both CLIs over the shared cases and diffs their output.
##

TS_DIR := figma-downloader-ts
PY_DIR := figma-downloader-py

.DEFAULT_GOAL := help

.PHONY: help install typecheck test test-ts test-py parity audit clean

help: ## Show this help
	@echo "polyglot figma-downloader targets:"
	@echo "  make test        run BOTH test suites (Node + Python, offline)"
	@echo "  make test-ts     Node suite only"
	@echo "  make test-py     Python suite only"
	@echo "  make typecheck   typecheck both twins"
	@echo "  make parity      cross-language parity gate (both CLIs over shared cases)"
	@echo "  make audit       typecheck + test + parity (the full gate)"
	@echo "  make install     refresh Node lockfile (Python is stdlib-only)"
	@echo "  make clean       clean both packages"

install: ## Refresh the Node lockfile (Python needs nothing)
	$(MAKE) -C $(TS_DIR) install

typecheck: ## Typecheck both twins
	$(MAKE) -C $(TS_DIR) typecheck
	$(MAKE) -C $(PY_DIR) typecheck

test-ts: ## Node suite
	$(MAKE) -C $(TS_DIR) test

test-py: ## Python suite
	$(MAKE) -C $(PY_DIR) test

test: test-ts test-py ## Both suites

parity: ## Cross-language parity gate (Node vs Python over shared cases)
	node parity/run-parity.mjs

audit: typecheck test parity ## Full gate: typecheck + test + parity

clean: ## Clean both packages
	$(MAKE) -C $(TS_DIR) clean
	$(MAKE) -C $(PY_DIR) clean
