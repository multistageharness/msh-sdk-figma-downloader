##
## figma-downloader-py — self-contained Makefile
##
## Stdlib-only Python tool. No pip install required to run or test
## (uses the built-in unittest runner). Python >= 3.11.
##

PYTHON ?= python3
FILE_KEY ?= TFTCSGbqpyxex6QRYqqbzb

.DEFAULT_GOAL := help

.PHONY: help install typecheck test audit mock run clean

help: ## Show this help
	@echo "figma-downloader-py targets:"
	@echo "  make test        run the test suite (unittest, no deps, no network)"
	@echo "  make typecheck   py_compile every source file"
	@echo "  make mock        chunked download of the built-in offline fixture -> stdout"
	@echo "  make run         live download FILE_KEY=<key> (needs FIGMA_TOKEN)"
	@echo "  make audit       typecheck + test"
	@echo "  make clean       remove caches / out"

install: ## No-op (stdlib only); present for umbrella uniformity
	@echo "figma-downloader-py: stdlib only — nothing to install."

typecheck: ## Byte-compile every source file
	$(PYTHON) -m py_compile figma_downloader/*.py

test: ## Run the test suite (no deps, no network)
	$(PYTHON) -m unittest discover -s tests -t . -p 'test_*.py' -v

mock: ## Chunked download of the built-in offline fixture, printed to stdout
	$(PYTHON) -m figma_downloader --mock --pretty --stdout

run: ## Live chunked download (FILE_KEY=<key>, needs FIGMA_TOKEN)
	$(PYTHON) -m figma_downloader --file-key $(FILE_KEY)

audit: typecheck test ## typecheck + test

clean: ## Remove caches / out
	rm -rf out **/__pycache__ .pytest_cache
